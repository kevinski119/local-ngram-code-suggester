import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runVSCodeCommand } from '@vscode/test-electron';

async function main() {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const manifest = JSON.parse(
        fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf-8')
    ) as { publisher: string; name: string; version: string };
    const vsix = `${manifest.name}-${manifest.version}.vsix`;
    const vsixPath = path.join(extensionRoot, vsix);
    assert.ok(fs.existsSync(vsixPath), `package ${vsix} before running the smoke test`);
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ngram-vsix-'));
    const userDataDirectory = path.join(temporaryRoot, 'user-data');
    const extensionsDirectory = path.join(temporaryRoot, 'extensions');

    try {
        const profileArguments = [
            '--user-data-dir', userDataDirectory,
            '--extensions-dir', extensionsDirectory
        ];
        await runVSCodeCommand(
            [...profileArguments, '--install-extension', vsixPath, '--force'],
            { version: 'stable' }
        );
        const listed = await runVSCodeCommand(
            [...profileArguments, '--list-extensions', '--show-versions'],
            { version: 'stable' }
        );
        assert.ok(
            listed.stdout.toLowerCase().includes(
                `${manifest.publisher}.${manifest.name}@${manifest.version}`.toLowerCase()
            ),
            `installed extension was missing from --list-extensions output:\n${listed.stdout}`
        );
        console.log(`VSIX clean-profile installation passed: ${vsix}`);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
