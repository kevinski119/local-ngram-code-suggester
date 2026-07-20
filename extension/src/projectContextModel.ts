import * as path from 'path';
import * as vscode from 'vscode';

import { scanText } from './lexicalScanner';
import { getLanguageProfile } from './languageProfiles';
import { Suggestion } from './interfaces/suggestion';
import { EXTENSION_TO_LANGUAGE, LANGUAGE_ID_TO_EXTENSION } from './utils/constants';
import { serializeContext } from './utils/utils';

interface IndexedDocument {
    extension: string;
    raw: string[];
    normalized: string[];
}

type ContextCounts = Record<string, Record<string, number>>;
type OrderIndex = Record<number, ContextCounts>;
const MAX_PROJECT_DOCUMENT_CHARACTERS = 1_000_000;

export class ProjectContextModel {
    private projectNgrams: Record<string, OrderIndex> = {};
    private fileContents = new Map<string, IndexedDocument>();

    constructor(
        private maxOrder: number,
        private minOrder = 2
    ) {}

    public addDocument(document: vscode.TextDocument) {
        const extension = this.getDocumentExtension(document);
        if (!this.isSupportedExtension(extension)) {
            return;
        }

        const text = document.getText();
        if (text.length > MAX_PROJECT_DOCUMENT_CHARACTERS) {
            return;
        }
        const scan = scanText(text, document.languageId);
        const indexed: IndexedDocument = {
            extension,
            raw: scan.tokens.map(token => token.value),
            normalized: scan.tokens.map(token => token.normalized)
        };
        const key = document.uri.toString();
        const previous = this.fileContents.get(key);
        if (previous) {
            this.updateNgramsForFile(previous, -1);
        }
        this.fileContents.set(key, indexed);
        this.updateNgramsForFile(indexed, 1);
    }

    public removeDocument(document: vscode.TextDocument) {
        const key = document.uri.toString();
        const indexed = this.fileContents.get(key);
        if (indexed) {
            this.updateNgramsForFile(indexed, -1);
            this.fileContents.delete(key);
        }
    }

    public updateDocument(document: vscode.TextDocument) {
        this.addDocument(document);
    }

    private updateNgramsForFile(indexed: IndexedDocument, delta: 1 | -1) {
        const extensionIndex = this.projectNgrams[indexed.extension] ??= {};
        for (let order = this.minOrder; order <= this.maxOrder; order++) {
            const orderIndex = extensionIndex[order] ??= {};
            for (let i = 0; i <= indexed.raw.length - order; i++) {
                const context = indexed.normalized.slice(i, i + order - 1);
                const nextToken = indexed.raw[i + order - 1];
                const contextKey = serializeContext(context);
                const counts = orderIndex[contextKey] ??= {};
                counts[nextToken] = (counts[nextToken] ?? 0) + delta;
                if (counts[nextToken] <= 0) {
                    delete counts[nextToken];
                }
                if (Object.keys(counts).length === 0) {
                    delete orderIndex[contextKey];
                }
            }
        }
    }

    public generateProjectSuggestions(
        normalizedContext: string[],
        languageExtensions: string[],
        maxSuggestions: number,
        minConfidence: number
    ): Suggestion[] {
        const scores = new Map<string, Suggestion>();

        for (const extension of languageExtensions) {
            const extensionIndex = this.projectNgrams[extension];
            if (!extensionIndex) {
                continue;
            }
            for (let order = this.maxOrder; order >= this.minOrder; order--) {
                if (normalizedContext.length < order - 1) {
                    continue;
                }
                const contextKey = serializeContext(
                    normalizedContext.slice(-(order - 1))
                );
                const nextTokens = extensionIndex[order]?.[contextKey];
                if (!nextTokens) {
                    continue;
                }
                const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);
                if (total <= 0) {
                    continue;
                }
                const backoffWeight = Math.pow(0.65, this.maxOrder - order);
                for (const [token, count] of Object.entries(nextTokens)) {
                    const confidence = (count / total) * backoffWeight * 0.9;
                    if (confidence < minConfidence) {
                        continue;
                    }
                    const existing = scores.get(token);
                    if (!existing || confidence > existing.confidence) {
                        scores.set(token, {
                            token,
                            confidence,
                            source: 'project',
                            order
                        });
                    }
                }
            }
        }

        return Array.from(scores.values())
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxSuggestions);
    }

    public getProjectStats(): { files: number; extensions: string[] } {
        return {
            files: this.fileContents.size,
            extensions: Array.from(
                new Set(Array.from(this.fileContents.values(), item => item.extension))
            )
        };
    }

    public clear() {
        this.projectNgrams = {};
        this.fileContents.clear();
    }

    private getDocumentExtension(document: vscode.TextDocument): string {
        const direct = path.extname(document.fileName).toLowerCase() ||
            LANGUAGE_ID_TO_EXTENSION[document.languageId];
        if (direct) return direct;
        const header = document.getText().slice(0, 256);
        return header.startsWith('#!')
            ? getLanguageProfile(undefined, header).extensions[0]
            : '';
    }

    private isSupportedExtension(extension: string): boolean {
        return extension in EXTENSION_TO_LANGUAGE;
    }
}
