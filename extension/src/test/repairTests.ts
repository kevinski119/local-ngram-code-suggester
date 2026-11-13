import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

import { CodeModel } from '../interfaces/codeModel';
import { scanText } from '../lexicalScanner';
import {
    ALTERNATIVE_MIN_GAIN, findRepairs, HINT_MIN_GAIN, NgramScorer, QUICK_FIX_MIN_GAIN, RepairFix
} from '../repairEngine';
import { serializeContext } from '../utils/utils';

/** Build a small v3 model from source text the same way the trainer counts n-grams. */
function trainModel(source: string, language: string, extension: string, maxOrder = 4): CodeModel {
    const tokens = scanText(source, language).tokens;
    const orders: Record<string, Record<string, Record<string, number>>> = {};
    const frequencies: Record<string, number> = {};
    tokens.forEach((token, index) => {
        frequencies[token.value] = (frequencies[token.value] ?? 0) + 1;
        for (let order = 2; order <= maxOrder; order++) {
            if (index < order - 1) continue;
            const key = serializeContext(tokens.slice(index - order + 1, index).map(t => t.normalized));
            const table = (orders[String(order)] ??= {});
            const counts = (table[key] ??= {});
            counts[token.value] = (counts[token.value] ?? 0) + 1;
        }
    });
    return {
        version: 'test', n: maxOrder, format_version: 3, min_order: 2, max_order: maxOrder,
        normalized_contexts: true, orders: { [extension]: orders },
        token_frequencies: { [extension]: frequencies },
        file_extensions: [extension], total_patterns: tokens.length
    };
}

function apply(text: string, fix: RepairFix): string {
    return text.slice(0, fix.start) + fix.replacement + text.slice(fix.end);
}

const PYTHON_CORPUS = [
    'print("ready")', 'print("done")', 'name = input("Name: ")', 'print(name)',
    'log("starting")', 'print(value, other)', 'total = add(first, second)', 'result = call("text")'
].join('\n').repeat(20);

let bundled: CodeModel | undefined;
function bundledModel(): CodeModel {
    bundled ??= JSON.parse(zlib.gunzipSync(
        fs.readFileSync(path.join(__dirname, '..', '..', 'models', 'model.json.gz'))).toString()) as CodeModel;
    return bundled;
}

const quickFix = { minGain: QUICK_FIX_MIN_GAIN, alternativeMinGain: ALTERNATIVE_MIN_GAIN };

export const repairTests = [
    { name: 'quick fix offers to quote bare words passed as an argument', run: () => {
        const scorer = NgramScorer.create([trainModel(PYTHON_CORPUS, 'python', '.py')], ['.py'], 'python');
        assert.ok(scorer);
        const text = 'print(hello world)\n';
        const fixes = findRepairs(text, 'python', scorer, quickFix, [0]);
        assert.ok(fixes.some(fix => apply(text, fix) === 'print("hello world")\n'),
            fixes.map(fix => fix.title).join(', '));
    } },
    { name: 'quick fix with the bundled model includes the string repair', run: () => {
        const scorer = NgramScorer.create([bundledModel()], ['.py'], 'python');
        const text = 'print(hello world)\n';
        const results = findRepairs(text, 'python', scorer, quickFix, [0]).map(fix => apply(text, fix));
        assert.ok(results.includes('print("hello world")\n'), results.join(' | '));
    } },
    { name: 'quote repair falls back to single quotes and skips mixed quotes', run: () => {
        const scorer = NgramScorer.create([trainModel(PYTHON_CORPUS, 'python', '.py')], ['.py'], 'python');
        const titles = findRepairs('print(don"t stop)\n', 'python', scorer, { minGain: -Infinity, maxPerLine: 20 }, [0])
            .map(fix => fix.replacement);
        assert.ok(!titles.some(replacement => replacement.startsWith('"')));
    } },
    { name: 'well-formed lines produce no quick fix', run: () => {
        const scorer = NgramScorer.create([trainModel(PYTHON_CORPUS, 'python', '.py')], ['.py'], 'python');
        assert.deepEqual(findRepairs('print("hello world")\nname = input("Name: ")\n', 'python', scorer, quickFix), []);
    } },
    { name: 'structural repair inserts a missing Python block colon', run: () => {
        const text = 'for item in items\n    print(item)\n';
        const fixes = findRepairs(text, 'python', undefined, quickFix);
        assert.equal(fixes.length, 1);
        assert.equal(apply(text, fixes[0]), 'for item in items:\n    print(item)\n');
        assert.deepEqual(findRepairs('for item in items:\n    print(item)\n', 'python', undefined, quickFix), []);
    } },
    { name: 'structural repair closes a bracket before the statement terminator', run: () => {
        const ts = 'const x = foo(1, 2;\nconst y = 3;\n';
        assert.equal(apply(ts, findRepairs(ts, 'typescript', undefined, quickFix)[0]), 'const x = foo(1, 2);\nconst y = 3;\n');
        const py = 'def area(width, height:\n    return width * height\n';
        assert.deepEqual(findRepairs(py, 'python', undefined, quickFix), [],
            'an indented next line may continue the bracket; leave it to the model');
        const condition = 'if (ready {\n    go();\n}\n';
        assert.equal(apply(condition, findRepairs(condition, 'typescript', undefined, quickFix)[0]), 'if (ready) {\n    go();\n}\n');
    } },
    { name: 'structural repair leaves wrapped calls and callbacks alone', run: () => {
        assert.deepEqual(findRepairs('call(first,\n     second)\n', 'python', undefined, quickFix), []);
        assert.deepEqual(findRepairs('run(function () {\n    go();\n});\n', 'javascript', undefined, quickFix), []);
        assert.deepEqual(findRepairs('items.map(item =>\n    item.id)\n', 'typescript', undefined, quickFix), []);
    } },
    { name: 'method names such as toString are not treated as brackets', run: () => {
        const scorer = NgramScorer.create([bundledModel()], ['.ts'], 'typescript');
        const fixes = findRepairs('const key = document.uri.toString();\n', 'typescript', scorer, { minGain: -Infinity, maxPerLine: 50 });
        assert.ok(fixes.every(fix => !fix.replacement.includes('native code')));
    } },
    { name: 'bundled model raises no hints on the benchmark fixtures', run: () => {
        const fixtures = path.join(__dirname, '..', '..', '..', 'benchmarks', 'fixtures');
        for (const [file, language, extension] of [
            ['sample.py', 'python', '.py'], ['sample.ts', 'typescript', '.ts'], ['sample.java', 'java', '.java']
        ]) {
            const scorer = NgramScorer.create([bundledModel()], [extension], language);
            const text = fs.readFileSync(path.join(fixtures, file), 'utf8');
            assert.deepEqual(findRepairs(text, language, scorer, quickFix), [], file);
            assert.deepEqual(findRepairs(text, language, scorer, { minGain: HINT_MIN_GAIN }), [], file);
        }
    } },
    { name: 'scorer ignores legacy models without normalized contexts', run: () => {
        assert.equal(NgramScorer.create([{ version: '2', n: 3, file_extensions: ['.py'], total_patterns: 0, ngrams: {} }], ['.py'], 'python'), undefined);
    } },
    { name: 'repairs stop when cancelled', run: () => {
        const scorer = NgramScorer.create([trainModel(PYTHON_CORPUS, 'python', '.py')], ['.py'], 'python');
        assert.deepEqual(findRepairs('print(hello world)\n', 'python', scorer, { ...quickFix, shouldCancel: () => true }), []);
    } }
];
