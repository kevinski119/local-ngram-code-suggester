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
    status.command = 'codeSuggester.showMenu';
    status.name = 'Local N-Gram Code Suggester';

    const updateStatus = () => {
        const diagnostics = suggester.getDiagnostics();
        const enabled = vscode.workspace.getConfiguration('codeSuggester').get<boolean>('enabled', true);
        if (!enabled) {
            status.text = '$(debug-pause) N-Gram';
            status.tooltip = 'Suggestions paused. Click to resume or change settings.';
        } else if (!suggester.isModelLoaded) {
            status.text = '$(warning) N-Gram';
            status.tooltip = 'Local N-Gram model is not loaded';
        } else {
            status.text = '$(sparkle) N-Gram';
            status.tooltip = `Local model • ${diagnostics.patterns.toLocaleString()} patterns • ` +
                `${diagnostics.projectFiles} open files learned • p95 ${diagnostics.p95LatencyMs.toFixed(1)} ms\nClick for controls`;
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
        output.appendLine(`Prefix scans reused: ${diagnostics.scanCacheHits}; computed: ${diagnostics.scanCacheMisses}`);
        output.appendLine(`Accepted suggestions this session: ${diagnostics.acceptedSuggestions}`);
        output.appendLine(`Session preference contexts: ${diagnostics.preferenceContexts}`);
        output.appendLine(`Project files: ${diagnostics.projectFiles}`);
        output.appendLine(`Cross-project learned contexts: ${diagnostics.learnedContexts}`);
        output.appendLine(`Cross-project support projects: ${diagnostics.learnedProjects}`);
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
        vscode.commands.registerCommand('codeSuggester.acceptSuggestion', (key: unknown, text: unknown) => {
            suggester.recordAcceptedSuggestion(key, text);
        }),
        vscode.commands.registerCommand('codeSuggester.clearAcceptanceMemory', () => {
            suggester.clearAcceptanceMemory();
            vscode.window.showInformationMessage('Session suggestion preferences cleared.');
        }),
        vscode.commands.registerCommand('codeSuggester.toggleEnabled', async () => {
            const config = vscode.workspace.getConfiguration('codeSuggester');
            const target = config.inspect<boolean>('enabled')?.workspaceValue === undefined
                ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
            await config.update('enabled', !config.get<boolean>('enabled', true), target);
            updateStatus();
        }),
        vscode.commands.registerCommand('codeSuggester.showMenu', async () => {
            const enabled = vscode.workspace.getConfiguration('codeSuggester').get<boolean>('enabled', true);
            const items = [
                { label: enabled ? '$(debug-pause) Pause suggestions' : '$(play) Resume suggestions', description: 'Local completion only', command: 'codeSuggester.toggleEnabled' },
                { label: '$(settings-gear) Settings', description: 'Frequency, length, confidence and learning', command: 'workbench.action.openSettings' },
                { label: '$(pulse) Diagnostics', description: 'Model, learned files and latency', command: 'codeSuggester.showDiagnostics' },
                { label: '$(refresh) Relearn open files', description: 'Refresh project patterns', command: 'codeSuggester.reloadProjectContext' },
                { label: '$(clear-all) Clear project context', description: 'Forget patterns from this window', command: 'codeSuggester.clearProjectContext' },
                { label: '$(discard) Reset session preferences', description: 'Forget which suggestions you accepted', command: 'codeSuggester.clearAcceptanceMemory' },
                { label: '$(package) Language packs', description: 'Import a local model or browse a configured catalog', command: 'codeSuggester.manageLanguagePacks' }
            ];
            const choice = await vscode.window.showQuickPick(items, {
                title: 'Local N-Gram · Offline completion', placeHolder: 'Runs on your machine. No account or LLM required.'
            });
            if (choice) await vscode.commands.executeCommand(choice.command,
                ...(choice.command === 'workbench.action.openSettings' ? ['@ext:KevinJarz.local-ngram-code-suggester'] : []));
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('codeSuggester')) updateStatus();
        }),
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
            'codeSuggester.clearCrossProjectLearning',
            guarded(async () => {
                await suggester.clearCrossProjectLearning();
                vscode.window.showInformationMessage(
                    'Cross-project learning history cleared.'
                );
            })
        ),
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
