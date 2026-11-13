import * as vscode from 'vscode';

import { CodeSuggester } from '../codeSuggester';
import { ALTERNATIVE_MIN_GAIN, HINT_MIN_GAIN, QUICK_FIX_MIN_GAIN, RepairFix } from '../repairEngine';

const MAX_LINES_PER_REQUEST = 5;
const HINT_DELAY_MS = 900;
const MAX_PENDING_HINT_LINES = 40;
const HINT_SOURCE = 'Local N-Gram';

function settings() {
    const config = vscode.workspace.getConfiguration('codeSuggester');
    return {
        quickFix: config.get<boolean>('enabled', true) && config.get<boolean>('quickFix.enabled', true),
        hints: config.get<boolean>('enabled', true) && config.get<boolean>('quickFix.showHints', false)
    };
}

function fixRange(document: vscode.TextDocument, fix: RepairFix): vscode.Range {
    return new vscode.Range(document.positionAt(fix.start), document.positionAt(fix.end));
}

/** Lightbulb / Ctrl+. repairs ranked by the n-gram model. */
export class CodeRepairProvider implements vscode.CodeActionProvider {
    static readonly metadata: vscode.CodeActionProviderMetadata = {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    };

    constructor(private readonly suggester: CodeSuggester) { }

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        if (!settings().quickFix) return [];
        if (context.only && !vscode.CodeActionKind.QuickFix.contains(context.only) &&
            !context.only.contains(vscode.CodeActionKind.QuickFix)) {
            return [];
        }
        const lines: number[] = [];
        for (let line = range.start.line; line <= range.end.line && lines.length < MAX_LINES_PER_REQUEST; line++) {
            lines.push(line);
        }
        const fixes = this.suggester.findRepairs(document, lines, {
            minGain: QUICK_FIX_MIN_GAIN,
            alternativeMinGain: ALTERNATIVE_MIN_GAIN,
            shouldCancel: () => token.isCancellationRequested
        });
        return fixes.map(fix => {
            const target = fixRange(document, fix);
            const action = new vscode.CodeAction(`N-Gram: ${fix.title}`, vscode.CodeActionKind.QuickFix);
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(document.uri, target, fix.replacement);
            action.diagnostics = context.diagnostics.filter(diagnostic =>
                diagnostic.range.start.line <= target.end.line && diagnostic.range.end.line >= target.start.line);
            return action;
        });
    }
}

/**
 * Optional faint hints on lines you edited and then left, so a slip such as
 * `print(hello world)` is pointed out after you move on. Only edited lines
 * are checked, never the whole file.
 */
export class RepairHints implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('local-ngram-repairs');
    private readonly pending = new Map<string, Set<number>>();
    private readonly disposables: vscode.Disposable[] = [];
    private timer: NodeJS.Timeout | undefined;

    constructor(private readonly suggester: CodeSuggester, private readonly selector: vscode.DocumentSelector) {
        this.disposables.push(
            this.collection,
            vscode.workspace.onDidChangeTextDocument(event => this.onChange(event)),
            vscode.window.onDidChangeTextEditorSelection(() => { if (this.pending.size) this.schedule(); }),
            vscode.workspace.onDidCloseTextDocument(document => {
                this.pending.delete(document.uri.toString());
                this.collection.delete(document.uri);
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('codeSuggester') && !settings().hints) this.clear();
            })
        );
    }

    clear(): void {
        this.pending.clear();
        this.collection.clear();
    }

    private onChange(event: vscode.TextDocumentChangeEvent): void {
        const { document } = event;
        if (!settings().hints || event.contentChanges.length === 0 || !vscode.languages.match(this.selector, document)) return;
        const key = document.uri.toString();
        let diagnostics = [...(this.collection.get(document.uri) ?? [])];
        let lines = Array.from(this.pending.get(key) ?? []);
        // Apply from the bottom up so earlier changes do not shift later ones.
        const changes = [...event.contentChanges].sort((a, b) => b.range.start.line - a.range.start.line);
        for (const change of changes) {
            const start = change.range.start.line;
            const end = change.range.end.line;
            const added = (change.text.match(/\n/g) ?? []).length;
            const delta = added - (end - start);
            const move = (line: number) => line > end ? line + delta : line;
            diagnostics = diagnostics
                .filter(diagnostic => diagnostic.range.start.line < start || diagnostic.range.start.line > end)
                .map(diagnostic => {
                    if (!delta || diagnostic.range.start.line <= end) return diagnostic;
                    const moved = new vscode.Diagnostic(
                        new vscode.Range(diagnostic.range.start.translate(delta), diagnostic.range.end.translate(delta)),
                        diagnostic.message, diagnostic.severity);
                    moved.source = diagnostic.source;
                    return moved;
                });
            lines = lines.filter(line => line < start || line > end).map(move);
            for (let line = start; line <= start + added; line++) lines.push(line);
        }
        this.collection.set(document.uri, diagnostics);
        this.pending.set(key, new Set(lines.slice(-MAX_PENDING_HINT_LINES)));
        this.schedule();
    }

    private schedule(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), HINT_DELAY_MS);
    }

    private flush(): void {
        this.timer = undefined;
        if (!settings().hints) return;
        for (const document of vscode.workspace.textDocuments) {
            const key = document.uri.toString();
            const lines = this.pending.get(key);
            if (!lines?.size) continue;
            // Leave the line being typed alone until the cursor moves away.
            const editor = vscode.window.activeTextEditor;
            const activeLine = editor?.document === document ? editor.selection.active.line : -1;
            const ready = Array.from(lines).filter(line => line !== activeLine && line < document.lineCount);
            if (!ready.length) continue;
            // Only the active line stays pending; lines past the end are gone.
            for (const line of lines) if (line !== activeLine) lines.delete(line);
            const checked = new Set(ready);
            const kept = (this.collection.get(document.uri) ?? []).filter(diagnostic => !checked.has(diagnostic.range.start.line));
            const found = this.suggester.findRepairs(document, ready, { minGain: HINT_MIN_GAIN, maxPerLine: 1 })
                .map(fix => {
                    let target = fixRange(document, fix);
                    // An insertion has no width; mark the character before it so the hint is visible.
                    if (target.isEmpty && target.start.character > 0) {
                        target = new vscode.Range(target.start.translate(0, -1), target.start);
                    }
                    const diagnostic = new vscode.Diagnostic(
                        target, `Looks unusual. ${fix.title}? (Ctrl+. to apply)`, vscode.DiagnosticSeverity.Hint);
                    diagnostic.source = HINT_SOURCE;
                    return diagnostic;
                });
            this.collection.set(document.uri, [...kept, ...found]);
        }
    }

    dispose(): void {
        if (this.timer) clearTimeout(this.timer);
        this.disposables.forEach(disposable => disposable.dispose());
        this.pending.clear();
    }
}
