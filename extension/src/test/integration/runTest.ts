import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
    // Keep Unix socket paths short and isolate each run from previous profiles.
    const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ng-test-'));
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..');
        const extensionTestsPath = path.resolve(__dirname, 'suite');
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                '--disable-extensions',
                '--user-data-dir', path.join(profileRoot, 'user'),
                '--extensions-dir', path.join(profileRoot, 'extensions')
            ]
        });
    } catch (error) {
        console.error('Extension Host tests failed:', error);
        process.exitCode = 1;
    } finally {
        fs.rmSync(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

void main();
