import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

import { runVSCodeCommand } from '@vscode/test-electron';

async function main() {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const vsix = fs.readdirSync(extensionRoot)
        .find(filename => /^local-ngram-code-suggester-.*\.vsix$/.test(filename));
    assert.ok(vsix, 'package the VSIX before running the installation smoke test');
    const vsixPath = path.join(extensionRoot, vsix);
    const manifest = JSON.parse(
        fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf-8')
    ) as { publisher: string; name: string; version: string };

    await runVSCodeCommand(
        ['--install-extension', vsixPath, '--force'],
        { version: 'stable' }
    );
    const listed = await runVSCodeCommand(
        ['--list-extensions', '--show-versions'],
        { version: 'stable' }
    );
    assert.ok(
        listed.stdout.toLowerCase().includes(
            `${manifest.publisher}.${manifest.name}@${manifest.version}`.toLowerCase()
        ),
        `installed extension was missing from --list-extensions output:\n${listed.stdout}`
    );
    console.log(`VSIX clean-profile installation passed: ${vsix}`);
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
