import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..');
        const extensionTestsPath = path.resolve(__dirname, 'suite');
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--disable-extensions']
        });
    } catch (error) {
        console.error('Extension Host tests failed:', error);
        process.exitCode = 1;
    }
}

void main();
