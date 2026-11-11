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
    assert.ok(diagnostics.languages.includes('.rs'), 'Rust model must ship in the package');

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
        'codeSuggester.reloadModel',
        'codeSuggester.showDiagnostics',
        'codeSuggester.manageLanguagePacks',
        'codeSuggester.clearCrossProjectLearning',
        'codeSuggester.toggleEnabled', 'codeSuggester.showMenu'
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

    for (const language of ['java', 'json', 'jsonc', 'rust']) {
        const supportedDocument = await vscode.workspace.openTextDocument({
            language,
            content: language === 'rust' ? 'let values = Vec::' : language === 'java'
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

    const expressionDocument = await vscode.workspace.openTextDocument({
        language: 'python',
        content: 'import pygame\ncenter_y = screen.'
    });
    const expressionConfiguration = vscode.workspace.getConfiguration('codeSuggester');
    const originalExpressionSettings = {
        preset: expressionConfiguration.get<string>('performancePreset'),
        multiToken: expressionConfiguration.get<boolean>('enableMultiToken'),
        maxTokens: expressionConfiguration.get<number>('maxInlineTokens'),
        confidence: expressionConfiguration.get<number>('minConfidence')
    };
    await expressionConfiguration.update(
        'performancePreset', 'quality', vscode.ConfigurationTarget.Global
    );
    await expressionConfiguration.update(
        'enableMultiToken', true, vscode.ConfigurationTarget.Global
    );
    await expressionConfiguration.update(
        'maxInlineTokens', 5, vscode.ConfigurationTarget.Global
    );
    await expressionConfiguration.update(
        'minConfidence', 0.85, vscode.ConfigurationTarget.Global
    );
    const expressionItems = api.getInlineSuggestions(
        expressionDocument,
        expressionDocument.positionAt(expressionDocument.getText().length)
    );
    assert.ok(expressionItems.length > 0, 'receiver-aware expression should be suggested');
    assert.equal(
        expressionItems[0].insertText,
        'get_height() / 2',
        'Quality mode should produce a useful bounded numeric expression'
    );
    await expressionConfiguration.update(
        'performancePreset',
        originalExpressionSettings.preset,
        vscode.ConfigurationTarget.Global
    );
    await expressionConfiguration.update(
        'enableMultiToken',
        originalExpressionSettings.multiToken,
        vscode.ConfigurationTarget.Global
    );
    await expressionConfiguration.update(
        'maxInlineTokens',
        originalExpressionSettings.maxTokens,
        vscode.ConfigurationTarget.Global
    );
    await expressionConfiguration.update(
        'minConfidence',
        originalExpressionSettings.confidence,
        vscode.ConfigurationTarget.Global
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

    const rustDocument = await vscode.workspace.openTextDocument({
        language: 'rust', content: 'fn sample() { let counter = 1; }\ncouter'
    });
    const prefixPosition = new vscode.Position(1, 3);
    const rustItems = api.getInlineSuggestions(rustDocument, prefixPosition);
    const counter = rustItems.find(item => typeof item.insertText === 'string' && item.insertText.startsWith('counter'));
    assert.ok(counter?.range, 'Rust project identifier should be available in the middle of a word');
    assert.equal(counter.range.start.character, 0, 'edit should include the typed prefix');
    assert.equal(counter.range.end.character, 6, 'edit should include the matching word suffix');
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider', rustDocument.uri, prefixPosition
    );
    const listCounter = list.items.find(item => typeof item.detail === 'string' && item.detail.startsWith('Project') && item.label === 'counter');
    assert.ok(listCounter, 'IntelliSense should offer the learned Rust identifier');
    assert.equal(listCounter.insertText, 'counter', 'IntelliSense must retain the typed prefix');

    const projectSequence = await vscode.workspace.openTextDocument({language: 'rust',
        content: 'fn run() { custom_store.flush(); custom_store.flush(); }\ncustom_store.'});
    const sequenceItems = api.getInlineSuggestions(projectSequence, new vscode.Position(1, 13));
    assert.ok(sequenceItems.some(item => typeof item.insertText === 'string' && item.insertText.startsWith('flush()')),
        'multi-token completion must continue a locally learned member call');

    await vscode.commands.executeCommand('codeSuggester.clearProjectContext');
    const rustPrefix = await vscode.workspace.openTextDocument({language: 'rust', content: 'prin'});
    assert.ok(api.getInlineSuggestions(rustPrefix, new vscode.Position(0, 4)).length > 0,
        'clearing project context must not erase bundled prefix completions');
    for (const content of ['let text = r##"unfinished //', '/* outside /* inside */ still outside']) {
        const doc = await vscode.workspace.openTextDocument({language: 'rust', content});
        assert.deepEqual(api.getInlineSuggestions(doc, doc.positionAt(content.length)), [],
            'Rust literals and nested comments must not receive code suggestions');
    }
    const originalEnabled = configuration.inspect<boolean>('enabled')?.globalValue;
    try {
        await configuration.update('enabled', false, vscode.ConfigurationTarget.Global);
        assert.deepEqual(api.getInlineSuggestions(rustPrefix, new vscode.Position(0, 4)), [], 'pause must suppress suggestions');
        await configuration.update('enabled', true, vscode.ConfigurationTarget.Global);
        assert.ok(api.getInlineSuggestions(rustPrefix, new vscode.Position(0, 4)).length > 0, 'resume must restore suggestions');
    } finally {
        await configuration.update('enabled', originalEnabled, vscode.ConfigurationTarget.Global);
    }

    const savedSettings = {
        tokens: configuration.inspect<number>('maxInlineTokens')?.globalValue,
        latency: configuration.inspect<number>('maxLatencyMs')?.globalValue,
        reuse: configuration.inspect<boolean>('reuseProjectSequences')?.globalValue,
        learn: configuration.inspect<boolean>('learnFromAcceptedSuggestions')?.globalValue
    };
    try {
        await configuration.update('maxInlineTokens', 12, vscode.ConfigurationTarget.Global);
        await configuration.update('maxLatencyMs', 250, vscode.ConfigurationTarget.Global);
        await configuration.update('reuseProjectSequences', true, vscode.ConfigurationTarget.Global);
        await configuration.update('learnFromAcceptedSuggestions', true, vscode.ConfigurationTarget.Global);
        const source = await vscode.workspace.openTextDocument({language: 'rust', content:
            'client.send_request( payload ).await?;\nclient.reset();\nclient.'});
        const cursor = new vscode.Position(2, 7);
        const items = api.getInlineSuggestions(source, cursor);
        assert.ok(items.some(item => item.insertText === 'send_request( payload ).await?;'),
            'retrieval should preserve an actual project expression, including original spacing');
        const alternative = items.find(item => item.insertText === 'reset();');
        assert.ok(alternative?.command, 'acceptance command must be attached to actual suggestions');
        const acceptedBefore = api.getDiagnostics().acceptedSuggestions;
        await vscode.commands.executeCommand(alternative.command.command, ...(alternative.command.arguments ?? []));
        assert.equal(api.getDiagnostics().acceptedSuggestions, acceptedBefore + 1);
        const ranked = api.getInlineSuggestions(source, cursor);
        assert.equal(ranked[0].insertText, 'reset();', 'accepting a choice should promote it in the same context');
        const hitsBefore = api.getDiagnostics().scanCacheHits;
        await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', source.uri, cursor);
        assert.ok(api.getDiagnostics().scanCacheHits > hitsBefore, 'IntelliSense should reuse the prefix scan');
        await configuration.update('learnFromAcceptedSuggestions', false, vscode.ConfigurationTarget.Global);
        assert.equal(api.getDiagnostics().preferenceContexts, 0, 'disabling preferences must erase them');
        assert.ok(api.getInlineSuggestions(source, cursor).every(item => !item.command), 'disabled preference learning must not attach callbacks');
        await configuration.update('reuseProjectSequences', false, vscode.ConfigurationTarget.Global);
        assert.ok(api.getInlineSuggestions(source, cursor).every(item => item.insertText !== 'send_request( payload ).await?;'),
            'turning off sequence reuse should restore model-generated suggestions');
    } finally {
        await configuration.update('maxInlineTokens', savedSettings.tokens, vscode.ConfigurationTarget.Global);
        await configuration.update('maxLatencyMs', savedSettings.latency, vscode.ConfigurationTarget.Global);
        await configuration.update('reuseProjectSequences', savedSettings.reuse, vscode.ConfigurationTarget.Global);
        await configuration.update('learnFromAcceptedSuggestions', savedSettings.learn, vscode.ConfigurationTarget.Global);
    }
}
