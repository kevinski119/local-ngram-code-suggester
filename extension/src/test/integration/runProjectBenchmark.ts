import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as assert from 'node:assert/strict';
import { runTests } from '@vscode/test-electron';
import type { BenchmarkFixture } from './projectBenchmark';
import { LANGUAGE_ID_TO_EXTENSION } from '../../utils/constants';

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ng-bench-'));
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
        const repository = path.dirname(extensionDevelopmentPath);
        const fixturePath = path.resolve(process.env.NGRAM_BENCH_FIXTURE ?? path.join(repository, 'benchmarks/project-fixtures.json'));
        const fixture: BenchmarkFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
        const folders: { path: string }[] = [];
        for (const entry of fixture.cases) {
            assert.match(entry.id, /^[a-z0-9-]+$/, 'Fixture IDs must be safe directory names');
            assert.equal(typeof LANGUAGE_ID_TO_EXTENSION[entry.language], 'string', 'Unsupported fixture language');
            const folder = path.join(root, entry.id);
            fs.mkdirSync(folder);
            folders.push({ path: folder });
            const suffix = LANGUAGE_ID_TO_EXTENSION[entry.language].slice(1);
            fs.writeFileSync(path.join(folder, `support.${suffix}`), entry.support);
            // The expected continuation never enters a learned or queried document.
            fs.writeFileSync(path.join(folder, `target.${suffix}`), entry.prefix);
            if (entry.foreignSupport) {
                const foreign = folder + '-foreign';
                fs.mkdirSync(foreign);
                folders.push({ path: foreign });
                fs.writeFileSync(path.join(foreign, `support.${suffix}`), entry.foreignSupport);
            }
        }
        const workspace = path.join(root, 'benchmark.code-workspace');
        fs.writeFileSync(workspace, JSON.stringify({ folders, settings: {
            'security.workspace.trust.enabled': false,
            'typescript.validate.enable': false,
            'javascript.validate.enable': false
        } }));
        await runTests({
            vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
            extensionDevelopmentPath,
            extensionTestsPath: path.join(__dirname, 'projectBenchmark'),
            extensionTestsEnv: {
                NGRAM_BENCH_ROOT: root,
                NGRAM_BENCH_FIXTURE: fixturePath,
                NGRAM_BENCH_OUTPUT: path.resolve(process.env.NGRAM_BENCH_OUTPUT ?? path.join(repository, 'benchmarks/project-latest.json')),
                NGRAM_BENCH_WARMUP: process.env.NGRAM_BENCH_WARMUP ?? '3',
                NGRAM_BENCH_REPEATS: process.env.NGRAM_BENCH_REPEATS ?? '20',
                NGRAM_BENCH_COLLECT_FAILURES: process.env.NGRAM_BENCH_COLLECT_FAILURES ?? ''
            },
            launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust',
                '--disable-extension', 'vscode.typescript-language-features',
                '--user-data-dir', path.join(root, 'user'), '--extensions-dir', path.join(root, 'extensions')]
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
