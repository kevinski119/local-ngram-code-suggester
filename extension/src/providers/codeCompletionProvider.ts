import * as vscode from 'vscode';

import { CodeSuggester } from '../codeSuggester';

export class CodeCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private suggester: CodeSuggester) { }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        const enabled = vscode.workspace
            .getConfiguration('codeSuggester')
            .get<boolean>('enableCompletionList', true);
        if (!enabled) {
            return [];
        }
        return this.suggester.getSuggestions(document, position);
    }
}
