import * as vscode from 'vscode';

import { CodeSuggester } from '../codeSuggester';
import { shouldOfferAutomaticSuggestion } from '../suggestionPolicy';


export class CodeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    constructor(private suggester: CodeSuggester) { }

    provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        const config = vscode.workspace.getConfiguration('codeSuggester');
        if (!config.get<boolean>('enableInlineSuggestions', true) || token.isCancellationRequested) {
            return [];
        }

        const useTriggerCharacters = config.get<boolean>('useTriggerCharacters', false);
        const line = document.lineAt(position.line).text.slice(0, position.character);
        const explicit = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
        if (
            !explicit &&
            !shouldOfferAutomaticSuggestion(
                line,
                config.get<number>('suggestionFrequency', 50)
            )
        ) {
            return [];
        }

        if (!useTriggerCharacters)
            return this.suggester.getInlineSuggestions(document, position, token);

        const triggerCharacters = new Set(['.', ',', ' ', '(', ')', '=', '{', '[', ':', ';']);

        // Get the character before the cursor
        const charBeforeCursor = line[position.character - 1];

        // Return empty array if character is not in trigger set
        if (!charBeforeCursor || !triggerCharacters.has(charBeforeCursor)) {
            return [];
        }

        return this.suggester.getInlineSuggestions(document, position, token);
    }
}
