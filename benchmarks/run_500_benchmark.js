const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { downloadAndUnzipVSCode } = require('../extension/node_modules/@vscode/test-electron');
const { generate, languages } = require('./generate_500_fixtures');

const round = value => Number(value.toFixed(6));
function summary(rows) {
    const quality = rows.filter(row => row.controlPassed === null);
    const controls = rows.filter(row => row.controlPassed !== null);
    const count = key => quality.filter(row => row[key]).length;
    return {
        cases: rows.length, qualityCases: quality.length,
        covered: count('covered'), nextTokenCorrect: count('top1Token'),
        fullContinuationCorrect: count('top1ExactTokens'), fullContinuationTop3: count('top3ExactTokens'),
        exactTextCorrect: count('top1ExactText'),
        wrongFirstToken: quality.filter(row => row.covered && !row.top1Token).length,
        nextTokenAccuracy: round(count('top1Token') / quality.length),
        fullContinuationAccuracy: round(count('top1ExactTokens') / quality.length),
        correctLeadingTokenFraction: round(quality.reduce((sum, row) => sum + row.correctPrefixTokens, 0) /
            quality.reduce((sum, row) => sum + row.targetTokens, 0)),
        controls: controls.length, controlsPassed: controls.filter(row => row.controlPassed).length,
        failedControls: controls.filter(row => !row.controlPassed).map(row => row.id)
    };
}

async function main() {
    const extension = path.resolve(__dirname, '../extension');
    const fixture = generate();
    fs.writeFileSync(path.join(__dirname, 'project-500-fixtures.json'), JSON.stringify(fixture, null, 2) + '\n');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ng-500-'));
    const batches = [];
    try {
        const executable = process.env.VSCODE_EXECUTABLE_PATH || await downloadAndUnzipVSCode('stable');
        for (let start = 0; start < fixture.cases.length; start += 20) {
            const cases = fixture.cases.slice(start, start + 20);
            const fixturePath = path.join(root, `fixture-${start}.json`);
            const output = path.join(root, `result-${start}.json`);
            fs.writeFileSync(fixturePath, JSON.stringify({ ...fixture, cases }));
            console.log(`Running cases ${start + 1}-${start + cases.length}/500 (${cases[0].language}), six feature/token configurations...`);
            const child = spawnSync(process.execPath, [path.join(extension, 'out/test/integration/runProjectBenchmark.js')], {
                cwd: extension, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
                env: { ...process.env, VSCODE_EXECUTABLE_PATH: executable,
                    NGRAM_BENCH_FIXTURE: fixturePath, NGRAM_BENCH_OUTPUT: output,
                    NGRAM_BENCH_WARMUP: '1', NGRAM_BENCH_REPEATS: '3', NGRAM_BENCH_COLLECT_FAILURES: '1' }
            });
            if (child.status !== 0) {
                fs.writeFileSync(path.join(__dirname, 'project-500-batch-failure.log'), (child.stdout || '') + (child.stderr || ''));
                throw new Error(`Batch ${start + 1} failed (${child.status}): ${child.error || (child.stderr || child.stdout).slice(-1800)}. See benchmarks/project-500-batch-failure.log`);
            }
            const result = JSON.parse(fs.readFileSync(output, 'utf8'));
            assert.equal(result.variants.length, 6);
            for (const variant of result.variants) {
                assert.equal(variant.cases.length, cases.length);
                assert.ok(variant.indexedFiles < 128, 'Batch must stay below the document cap');
            }
            batches.push(result);
            const newest = result.variants.find(variant => variant.mode === 'project_and_reuse' && variant.maxTokens === 5);
            console.log(`Finished ${start + cases.length}/500; latest/default: ${JSON.stringify(summary(newest.cases))}`);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    for (const batch of batches) {
        assert.equal(batch.engineSha256, batches[0].engineSha256);
        assert.equal(batch.modelSha256, batches[0].modelSha256);
        assert.equal(batch.vscodeVersion, batches[0].vscodeVersion);
    }
    const variants = batches[0].variants.map(first => {
        const rows = batches.flatMap(batch => batch.variants.find(variant => variant.mode === first.mode && variant.maxTokens === first.maxTokens).cases);
        assert.equal(rows.length, 500);
        assert.equal(new Set(rows.map(row => row.id)).size, 500);
        const byLanguage = Object.fromEntries(languages.map(language => {
            const selected = rows.filter(row => row.language === language);
            assert.equal(selected.length, 100);
            return [language, summary(selected)];
        }));
        return { mode: first.mode, maxTokens: first.maxTokens, summary: summary(rows), byLanguage,
            byGroup: Object.fromEntries([...new Set(rows.map(row => row.group))].map(group => [group, summary(rows.filter(row => row.group === group))])), cases: rows };
    });
    const metadata = {
        schemaVersion: 1, extensionVersion: batches[0].extensionVersion, vscodeVersion: batches[0].vscodeVersion,
        environment: batches[0].environment, fixtureSha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
        modelSha256: batches[0].modelSha256, engineSha256: batches[0].engineSha256,
        methodology: { ...batches[0].methodology,
            split: '500 cases, 100 each Rust/TypeScript/Python/Java/C#. Twenty-five fresh-profile batches of 20 cases, each with separate workspace folders and only support plus target prefixes opened. No expected suffix is indexed.',
            scoring: '400 quality cases (80/language) plus 100 separate isolation/suppression controls (20/language). Six configurations yield 3000 case/configuration pairs. Missing suggestions are misses; controls are not included in accuracy.',
            limitation: 'Deterministic synthetic coverage: ten related scenario templates times ten domain variations per language. Not 500 independent real-world programs; no statistical population inference. 250ms budget, not the 35ms default. No production engine changes.' }
    };
    fs.writeFileSync(path.join(__dirname, 'project-500-latest.json'), JSON.stringify({ ...metadata, variants, batchTimings: batches.map(batch => batch.variants.map(variant => ({ mode: variant.mode, maxTokens: variant.maxTokens, indexMs: variant.indexMs, indexedFiles: variant.indexedFiles }))) }, null, 2) + '\n');
    fs.writeFileSync(path.join(__dirname, 'project-500-summary.json'), JSON.stringify({ ...metadata, variants: variants.map(({ cases, ...rest }) => rest) }, null, 2) + '\n');
    const columns = ['id', 'language', 'group', 'mode', 'maxTokens', 'covered', 'top1Token', 'top3Token', 'top1ExactTokens', 'top3ExactTokens', 'top1ExactText', 'correctPrefixTokens', 'targetTokens', 'controlPassed', 'expected', 'firstCandidate'];
    const csv = [columns, ...variants.flatMap(variant => variant.cases.map(row => {
        const record = { ...row, mode: variant.mode, maxTokens: variant.maxTokens, firstCandidate: row.candidates[0] || '' };
        return columns.map(column => record[column] ?? '');
    }))].map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\n');
    fs.writeFileSync(path.join(__dirname, 'project-500-cases.csv'), csv + '\n');
    for (const variant of variants) console.log(JSON.stringify({ mode: variant.mode, maxTokens: variant.maxTokens, ...variant.summary, byLanguage: variant.byLanguage }));
    console.log('Completed all 500 distinct cases in all six configurations. Reports: benchmarks/project-500-{latest.json,summary.json,cases.csv}');
    // Finish every case and save the evidence before signaling a failed control.
    if (variants.some(variant => variant.summary.controlsPassed !== variant.summary.controls)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
