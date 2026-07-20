import * as path from 'path';
import * as vscode from 'vscode';

import { CodeSuggester, SuggesterDiagnostics } from './codeSuggester';
import { LanguagePackManager } from './languagePackManager';
import { CodeCompletionProvider } from './providers/codeCompletionProvider';
import { CodeInlineCompletionProvider } from './providers/codeInlineCompletionProvider';
import { SUPPORTED_LANGUAGE_IDS } from './utils/constants';

export interface LocalNGramExtensionApi {
    getDiagnostics(): SuggesterDiagnostics;
    reloadModel(): Promise<boolean>;
    getInlineSuggestions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.InlineCompletionItem[];
}

export async function activate(
    context: vscode.ExtensionContext
): Promise<LocalNGramExtensionApi> {
    const suggester = new CodeSuggester(context);
    const packManager = new LanguagePackManager(context, suggester);
    const selector: vscode.DocumentSelector = [
        ...SUPPORTED_LANGUAGE_IDS.map(language => ({ language })),
        { language: 'plaintext', scheme: 'untitled' }
    ];
    const output = vscode.window.createOutputChannel('Local N-Gram Code Suggester');
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    status.command = 'codeSuggester.showDiagnostics';
    status.name = 'Local N-Gram Code Suggester';

    const updateStatus = () => {
        const diagnostics = suggester.getDiagnostics();
        if (!suggester.isModelLoaded) {
            status.text = '$(warning) N-Gram';
            status.tooltip = 'Local N-Gram model is not loaded';
        } else {
            status.text = `$(sparkle) N-Gram ${diagnostics.formatVersion}`;
            status.tooltip = `Local model • ${diagnostics.patterns.toLocaleString()} patterns • ` +
                `p95 ${diagnostics.p95LatencyMs.toFixed(1)} ms`;
        }
        status.show();
    };

    const showDiagnostics = () => {
        const diagnostics = suggester.getDiagnostics();
        const packs = packManager.getInstalledPacks();
        output.clear();
        output.appendLine('Local N-Gram Code Suggester diagnostics');
        output.appendLine(`Model version: ${diagnostics.modelVersion}`);
        output.appendLine(`Format version: ${diagnostics.formatVersion}`);
        output.appendLine(`Tokenizer profile: ${diagnostics.tokenizerProfileVersion}`);
        output.appendLine(`Model source: ${diagnostics.modelSource}`);
        output.appendLine(`Languages: ${diagnostics.languages.join(', ') || 'none'}`);
        output.appendLine(`Patterns: ${diagnostics.patterns.toLocaleString()}`);
        output.appendLine(`Load time: ${diagnostics.loadTimeMs.toFixed(1)} ms`);
        output.appendLine(`Last latency: ${diagnostics.lastLatencyMs.toFixed(1)} ms`);
        output.appendLine(`p95 latency: ${diagnostics.p95LatencyMs.toFixed(1)} ms`);
        output.appendLine(`Cache hit rate: ${(diagnostics.cacheHitRate * 100).toFixed(1)}%`);
        output.appendLine(`Cache entries: ${diagnostics.cacheEntries}`);
        output.appendLine(`Project files: ${diagnostics.projectFiles}`);
        output.appendLine(`Installed language packs: ${packs.length}`);
        for (const pack of packs) {
            output.appendLine(`  - ${pack.name} ${pack.version} (${pack.languages.join(', ')})`);
        }
        output.show(true);
    };

    const guarded = (
        operation: () => PromiseLike<unknown>
    ) => async () => {
        try {
            await operation();
            updateStatus();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Local N-Gram: ${message}`);
        }
    };

    context.subscriptions.push(
        suggester,
        output,
        status,
        vscode.languages.registerCompletionItemProvider(
            selector,
            new CodeCompletionProvider(suggester),
            '.', ' ', '(', '=', '{', '[', ':'
        ),
        vscode.languages.registerInlineCompletionItemProvider(
            selector,
            new CodeInlineCompletionProvider(suggester)
        ),
        vscode.commands.registerCommand(
            'codeSuggester.reloadModel',
            guarded(() => vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Reloading Local N-Gram model'
                },
                () => suggester.reloadModel()
            ))
        ),
        vscode.commands.registerCommand('codeSuggester.showStatus', () => {
            const diagnostics = suggester.getDiagnostics();
            const source = diagnostics.modelSource === 'none'
                ? 'none'
                : path.basename(diagnostics.modelSource);
            vscode.window.showInformationMessage(
                `Local N-Gram ${diagnostics.modelVersion}; ${diagnostics.patterns.toLocaleString()} ` +
                `patterns; ${diagnostics.projectFiles} project files; source ${source}.`
            );
        }),
        vscode.commands.registerCommand('codeSuggester.showDiagnostics', showDiagnostics),
        vscode.commands.registerCommand('codeSuggester.clearProjectContext', () => {
            suggester.clearProjectContext();
            vscode.window.showInformationMessage('Local project context cleared.');
            updateStatus();
        }),
        vscode.commands.registerCommand('codeSuggester.reloadProjectContext', () => {
            suggester.reloadProjectContext();
            vscode.window.showInformationMessage('Local project context rebuilt from open files.');
            updateStatus();
        }),
        vscode.commands.registerCommand(
            'codeSuggester.manageLanguagePacks',
            guarded(() => packManager.manage())
        ),
        vscode.commands.registerCommand(
            'codeSuggester.checkLanguagePackUpdates',
            guarded(() => packManager.checkForUpdates())
        ),
        vscode.window.onDidChangeActiveTextEditor(updateStatus)
    );

    void suggester.ready.then(() => {
        updateStatus();
        const config = vscode.workspace.getConfiguration('codeSuggester');
        if (
            packManager.getInstalledPacks().length > 0 &&
            config.get<boolean>('languagePacks.autoUpdate', false)
        ) {
            void packManager.checkForUpdates(false).catch(error =>
                console.warn('Automatic language-pack update check failed:', error)
            );
        }
    });

    updateStatus();
    await suggester.ready;
    return {
        getDiagnostics: () => suggester.getDiagnostics(),
        reloadModel: () => suggester.reloadModel(),
        getInlineSuggestions: (document, position) =>
            suggester.getInlineSuggestions(document, position)
    };
}

export function deactivate() {
    // VS Code disposes everything registered in the extension context.
}
