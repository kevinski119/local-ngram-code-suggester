import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import * as vscode from 'vscode';
import type { LocalNGramExtensionApi } from '../../extension';
import { scanText } from '../../lexicalScanner';

interface Case {
    id: string;
    language: string;
    group: string;
    support: string;
    prefix: string;
    expected: string;
    foreignSupport?: string;
    forbiddenToken?: string;
    expectEmpty?: boolean;
}
export interface BenchmarkFixture { schemaVersion: number; cases: Case[] }
interface Row {
    id: string;
    language: string;
    group: string;
    targetSeenInSupport: boolean;
    expected: string;
    candidates: string[];
    covered: boolean;
    top1Token: boolean;
    top3Token: boolean;
    top1ExactTokens: boolean;
    top3ExactTokens: boolean;
    top1ExactText: boolean;
    correctPrefixTokens: number;
    targetTokens: number;
    firstRequestMs: number;
    warmMedianMs: number;
    warmP95Ms: number;
    controlPassed: boolean | null;
}

const tokens = (text: string, language: string) => scanText(text, language).tokens.map(token => token.value);
const equal = (left: string[], right: string[]) => JSON.stringify(left) === JSON.stringify(right);
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const round = (value: number) => Number(value.toFixed(6));

function summarize(rows: Row[]) {
    const rate = (predicate: (row: Row) => boolean) => round(rows.filter(predicate).length / rows.length);
    return {
        cases: rows.length,
        coverage: rate(row => row.covered),
        top1NextToken: rate(row => row.top1Token),
        top3NextToken: rate(row => row.top3Token),
        top1FullTokenMatch: rate(row => row.top1ExactTokens),
        top3FullTokenMatch: rate(row => row.top3ExactTokens),
        top1ExactText: rate(row => row.top1ExactText),
        wrongFirstToken: rate(row => row.covered && !row.top1Token),
        correctPrefixTokenFraction: round(rows.reduce((sum, row) => sum + row.correctPrefixTokens, 0) /
            rows.reduce((sum, row) => sum + row.targetTokens, 0)),
        firstRequestP95Ms: round(percentile(rows.map(row => row.firstRequestMs), 0.95)),
        warmRequestP95Ms: round(percentile(rows.map(row => row.warmP95Ms), 0.95))
    };
}

function score(entry: Case, candidates: string[]): Omit<Row, 'firstRequestMs' | 'warmMedianMs' | 'warmP95Ms'> {
    const prefixScan = scanText(entry.prefix, entry.language);
    const last = prefixScan.tokens.at(-1);
    const anchor = prefixScan.tokens.length - (last?.kind === 'identifier' && last.end === entry.prefix.length ? 1 : 0);
    const target = entry.prefix + entry.expected;
    const expectedTokens = tokens(target, entry.language).slice(anchor);
    const choices = candidates.map(candidate => tokens(candidate, entry.language).slice(anchor));
    const first = choices[0] ?? [];
    let correctPrefixTokens = 0;
    while (correctPrefixTokens < Math.min(first.length, expectedTokens.length) &&
        first[correctPrefixTokens] === expectedTokens[correctPrefixTokens]) correctPrefixTokens++;
    const supportTokens = tokens(entry.support, entry.language);
    const fullTarget = tokens(target, entry.language);
    const seen = fullTarget.length > 0 && supportTokens.some((_, index) => equal(supportTokens.slice(index, index + fullTarget.length), fullTarget));
    return {
        id: entry.id, language: entry.language, group: entry.group,
        targetSeenInSupport: seen, expected: target, candidates,
        covered: choices.length > 0,
        top1Token: expectedTokens.length > 0 && first[0] === expectedTokens[0],
        top3Token: expectedTokens.length > 0 && choices.slice(0, 3).some(choice => choice[0] === expectedTokens[0]),
        top1ExactTokens: choices.length > 0 && equal(first, expectedTokens),
        top3ExactTokens: choices.slice(0, 3).some(choice => equal(choice, expectedTokens)),
        top1ExactText: candidates[0] === target,
        correctPrefixTokens, targetTokens: expectedTokens.length,
        controlPassed: entry.expectEmpty ? candidates.length === 0 : entry.forbiddenToken
            ? choices.every(choice => !choice.includes(entry.forbiddenToken!)) : null
    };
}

function verifyScoring() {
    const fixture: Case = { id: 'scorer', language: 'rust', group: 'test',
        support: 'store.append( item );', prefix: 'store.app', expected: 'end( item );' };
    const exact = score(fixture, ['store.append( item );']);
    assert.ok(exact.top1Token && exact.top1ExactTokens && exact.top1ExactText);
    const compact = score(fixture, ['store.append(item);']);
    assert.ok(compact.top1ExactTokens && !compact.top1ExactText, 'spacing is scored separately');
    const wrongArgument = score(fixture, ['store.append(other);']);
    assert.ok(wrongArgument.top1Token && !wrongArgument.top1ExactTokens);
    assert.equal(wrongArgument.correctPrefixTokens, 2, 'stop credit at the first wrong token');
    assert.ok(!score(fixture, ['store.append( item ); extra();']).top1ExactTokens, 'over-completion is not exact');
    assert.ok(!score(fixture, []).top1ExactTokens, 'abstentions are misses');
    assert.ok(score(fixture, ['store.clear();', 'store.append( item );']).top3ExactTokens);
    assert.ok(!score(fixture, ['store.clear();', 'store.clear();', 'store.clear();', 'store.append( item );']).top3ExactTokens);
}

export async function run(): Promise<void> {
    verifyScoring();
    const fixturePath = process.env.NGRAM_BENCH_FIXTURE!;
    const root = process.env.NGRAM_BENCH_ROOT!;
    const output = process.env.NGRAM_BENCH_OUTPUT!;
    assert.ok(fixturePath && root && output, 'run through npm run benchmark:project');
    const fixtureBytes = fs.readFileSync(fixturePath);
    const fixture: BenchmarkFixture = JSON.parse(fixtureBytes.toString());
    assert.equal(new Set(fixture.cases.map(entry => entry.id)).size, fixture.cases.length);
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'local-ngram-code-suggester')!;
    assert.ok(extension);
    const api: LocalNGramExtensionApi = await extension.activate();
    assert.ok(api.getDiagnostics().patterns > 0);
    const configuration = vscode.workspace.getConfiguration('codeSuggester');
    const settings: Record<string, unknown> = {
        enabled: true, minConfidence: 0.85, maxSuggestions: 5,
        performancePreset: 'quality', maxLatencyMs: 250, enableMultiToken: true,
        crossProjectLearning: false, learnFromAcceptedSuggestions: false,
        updateOnFileChange: false, suggestInComments: false, useProjectContext: false
    };
    for (const [key, value] of Object.entries(settings)) await configuration.update(key, value, vscode.ConfigurationTarget.Global);

    const documents = new Map<string, vscode.TextDocument>();
    for (const entry of fixture.cases) {
        const suffix = entry.language === 'rust' ? 'rs' : 'ts';
        const folder = path.join(root, entry.id);
        const support = await vscode.workspace.openTextDocument(path.join(folder, `support.${suffix}`));
        const target = await vscode.workspace.openTextDocument(path.join(folder, `target.${suffix}`));
        assert.equal(target.getText(), entry.prefix, 'target continuation must not be opened or indexed');
        assert.equal(support.getText(), entry.support);
        assert.equal(target.languageId, entry.language);
        assert.equal(vscode.workspace.getWorkspaceFolder(target.uri)?.uri.toString(),
            vscode.workspace.getWorkspaceFolder(support.uri)?.uri.toString());
        if (entry.foreignSupport) {
            const foreign = await vscode.workspace.openTextDocument(path.join(folder + '-foreign', `support.${suffix}`));
            assert.notEqual(vscode.workspace.getWorkspaceFolder(foreign.uri)?.uri.toString(),
                vscode.workspace.getWorkspaceFolder(target.uri)?.uri.toString());
        }
        documents.set(entry.id, target);
    }
    const modes = [
        { name: 'bundled_only', learning: false, reuse: false },
        { name: 'project_learning', learning: true, reuse: false },
        { name: 'project_and_reuse', learning: true, reuse: true }
    ];
    const variants: {
        mode: string; maxTokens: number; indexMs: number; indexedFiles: number;
        summary: ReturnType<typeof summarize>;
        byGroup: Record<string, ReturnType<typeof summarize>>;
        byLanguage: Record<string, ReturnType<typeof summarize>>;
        controls: { total: number; passed: number }; cases: Row[];
    }[] = [];
    for (const maxTokens of [5, 12]) {
        await configuration.update('maxInlineTokens', maxTokens, vscode.ConfigurationTarget.Global);
        for (const mode of modes) {
            await configuration.update('useProjectContext', mode.learning, vscode.ConfigurationTarget.Global);
            await configuration.update('reuseProjectSequences', mode.reuse, vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('codeSuggester.clearProjectContext');
            const indexStarted = performance.now();
            await vscode.commands.executeCommand('codeSuggester.reloadProjectContext');
            const indexMs = performance.now() - indexStarted;
            const indexedFiles = api.getDiagnostics().projectFiles;
            assert.equal(indexedFiles, mode.learning ? fixture.cases.length * 2 + fixture.cases.filter(entry => entry.foreignSupport).length : 0);
            const rows: Row[] = [];
            for (const entry of fixture.cases) {
                const document = documents.get(entry.id)!;
                const position = document.positionAt(entry.prefix.length);
                const request = () => api.getInlineSuggestions(document, position).map(item => {
                    assert.equal(typeof item.insertText, 'string');
                    const start = item.range ? document.offsetAt(item.range.start) : entry.prefix.length;
                    const end = item.range ? document.offsetAt(item.range.end) : entry.prefix.length;
                    return entry.prefix.slice(0, start) + item.insertText + entry.prefix.slice(end);
                });
                const started = performance.now();
                const candidates = request();
                const firstRequestMs = performance.now() - started;
                for (let warmup = 0; warmup < 3; warmup++) request();
                const timings = [];
                for (let repeat = 0; repeat < 20; repeat++) {
                    const tick = performance.now();
                    const repeated = request();
                    timings.push(performance.now() - tick);
                    assert.deepEqual(repeated, candidates, `${mode.name}/${entry.id}: nondeterministic result or exhausted time budget`);
                }
                const row = { ...score(entry, candidates), firstRequestMs: round(firstRequestMs),
                    warmMedianMs: round(percentile(timings, 0.5)), warmP95Ms: round(percentile(timings, 0.95)) };
                assert.notEqual(row.controlPassed, false, `Safety control failed: ${mode.name}/${entry.id}`);
                if (entry.group === 'repeated') assert.equal(row.targetSeenInSupport, true);
                if (['new_arguments', 'unseen'].includes(entry.group)) assert.equal(row.targetSeenInSupport, false);
                rows.push(row);
            }
            const quality = rows.filter(row => row.controlPassed === null);
            const byGroup = Object.fromEntries([...new Set(quality.map(row => row.group))].map(group => [group, summarize(quality.filter(row => row.group === group))]));
            const byLanguage = Object.fromEntries([...new Set(quality.map(row => row.language))].map(language => [language, summarize(quality.filter(row => row.language === language))]));
            variants.push({ mode: mode.name, maxTokens, indexMs: round(indexMs), indexedFiles,
                summary: summarize(quality), byGroup, byLanguage,
                controls: { total: rows.length - quality.length, passed: rows.filter(row => row.controlPassed === true).length }, cases: rows });
        }
    }
    const paired = [5, 12].flatMap(maxTokens => ['project_learning', 'project_and_reuse'].map((name, index) => {
        const before = variants.find(variant => variant.maxTokens === maxTokens && variant.mode === modes[index].name)!;
        const after = variants.find(variant => variant.maxTokens === maxTokens && variant.mode === name)!;
        const eligible = after.cases.filter(row => row.controlPassed === null);
        return { maxTokens, before: before.mode, after: after.mode,
            nextTokenWins: eligible.filter(row => row.top1Token && !before.cases.find(old => old.id === row.id)!.top1Token).map(row => row.id),
            nextTokenLosses: eligible.filter(row => !row.top1Token && before.cases.find(old => old.id === row.id)!.top1Token).map(row => row.id),
            fullMatchWins: eligible.filter(row => row.top1ExactTokens && !before.cases.find(old => old.id === row.id)!.top1ExactTokens).map(row => row.id),
            fullMatchLosses: eligible.filter(row => !row.top1ExactTokens && before.cases.find(old => old.id === row.id)!.top1ExactTokens).map(row => row.id) };
    }));
    const report = {
        schemaVersion: 1, extensionVersion: extension.packageJSON.version, vscodeVersion: vscode.version,
        environment: { platform: process.platform, arch: process.arch, osRelease: os.release(), node: process.version },
        fixtureSha256: hash(JSON.stringify(fixture)), modelSha256: hash(fs.readFileSync(path.join(extension.extensionPath, 'models/model.json.gz'))),
        engineSha256: hash(['codeSuggester.ts', 'projectContextModel.ts', 'projectSequences.ts', 'ngramEngine.ts',
            'lexicalScanner.ts', 'languageProfiles.json', 'completionEdit.ts', 'prefixScanCache.ts', 'acceptanceMemory.ts']
            .map(name => name + '\n' + fs.readFileSync(path.join(extension.extensionPath, 'src', name), 'utf8').replace(/\r\n/g, '\n')).join('\n')),
        methodology: { kind: 'Synthetic paired feature ablation in the actual VS Code Extension Host; not a historical v3.0 executable comparison.',
            settings, tokenLimits: [5, 12], warmupRequests: 3, measuredWarmRequests: 20,
            timing: 'Synchronous getInlineSuggestions including edits; excludes UI rendering, automatic trigger scheduling and model loading. First request is per case/mode, not a cold process. Index timing includes command dispatch.',
            split: 'Only support files and target prefixes are indexed. Targets are in separate files. Each case has its own workspace folder. Deliberate support repetitions are reported separately. No accepted suggestions or cross-project memory.',
            scoring: '20 quality cases, 4 separate safety controls. Missing suggestions are misses. Token matches ignore spacing; exact text preserves it. Prefix fraction counts only contiguous correct leading tokens; it is not measured user keystroke savings.',
            limitation: '24 authored Rust/TypeScript scenarios, not random held-out repositories or a population estimate. 250ms budget reduces deadline noise; it is not the 35ms default.' },
        variants, paired
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    for (const variant of variants) console.log(JSON.stringify({ mode: variant.mode, maxTokens: variant.maxTokens, ...variant.summary, controls: variant.controls }));
    console.log(`Project benchmark report: ${output}`);
}
