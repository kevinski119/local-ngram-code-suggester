import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { LocalNGramExtensionApi } from '../../extension';

export async function run(): Promise<void> {
    const extension = vscode.extensions.all.find(
        candidate => candidate.packageJSON.name === 'local-ngram-code-suggester'
    ) as vscode.Extension<LocalNGramExtensionApi> | undefined;
    assert.ok(extension, 'development extension should be discoverable');
    const api = await extension.activate();
    assert.ok(api, 'extension should export a testable API');

    const diagnostics = api.getDiagnostics();
    assert.ok(diagnostics.patterns > 0, 'bundled model should load');
    assert.ok(diagnostics.formatVersion >= 3, 'bundled model should use format v3');

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
        'codeSuggester.reloadModel',
        'codeSuggester.showDiagnostics',
        'codeSuggester.manageLanguagePacks',
        'codeSuggester.clearCrossProjectLearning'
    ]) {
        assert.ok(commands.includes(command), `${command} should be registered`);
    }

    const document = await vscode.workspace.openTextDocument({
        language: 'typescript',
        content: 'const value = 1; // comment'
    });
    const commentItems = api.getInlineSuggestions(
        document,
        document.positionAt(document.getText().length)
    );
    assert.deepEqual(commentItems, [], 'comments should not receive code suggestions');

    const codeDocument = await vscode.workspace.openTextDocument({
        language: 'typescript',
        content: 'export function'
    });
    assert.doesNotThrow(() =>
        api.getInlineSuggestions(
            codeDocument,
            codeDocument.positionAt(codeDocument.getText().length)
        )
    );

    for (const language of ['java', 'json', 'jsonc']) {
        const supportedDocument = await vscode.workspace.openTextDocument({
            language,
            content: language === 'java'
                ? 'public final class Example {'
                : '{"enabled": true,'
        });
        assert.doesNotThrow(() =>
            api.getInlineSuggestions(
                supportedDocument,
                supportedDocument.positionAt(supportedDocument.getText().length)
            ),
            `${language} should be supported by the inline provider`
        );
    }

    const completedPythonBoundary = await vscode.workspace.openTextDocument({
        language: 'python',
        content: 'if isinstance(value, float) and value.is_integer():'
    });
    assert.deepEqual(
        api.getInlineSuggestions(
            completedPythonBoundary,
            completedPythonBoundary.positionAt(completedPythonBoundary.getText().length)
        ),
        [],
        'an accepted block boundary should not trigger another completion on the same line'
    );

    const untitledPython = await vscode.workspace.openTextDocument({
        language: 'plaintext',
        content: '#!/usr/bin/env python3\nreturn'
    });
    assert.doesNotThrow(() =>
        api.getInlineSuggestions(
            untitledPython,
            untitledPython.positionAt(untitledPython.getText().length)
        )
    );

    const configuration = vscode.workspace.getConfiguration('codeSuggester');
    const originalPreset = configuration.get<string>('performancePreset');
    await configuration.update(
        'performancePreset',
        'fast',
        vscode.ConfigurationTarget.Global
    );
    assert.equal(
        vscode.workspace
            .getConfiguration('codeSuggester')
            .get<string>('performancePreset'),
        'fast'
    );
    await configuration.update(
        'performancePreset',
        originalPreset,
        vscode.ConfigurationTarget.Global
    );

    assert.equal(await api.reloadModel(), true, 'model reload should succeed');
}
