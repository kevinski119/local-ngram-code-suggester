import * as path from 'path';
import type * as vscode from 'vscode';

import { scanText } from './lexicalScanner';
import { getLanguageProfile } from './languageProfiles';
import { Suggestion } from './interfaces/suggestion';
import { EXTENSION_TO_LANGUAGE, LANGUAGE_ID_TO_EXTENSION } from './utils/constants';
import { serializeContext } from './utils/utils';
import { ProjectSequences } from './projectSequences';

interface IndexedDocument {
    extension: string;
    scope: string;
    raw: string[];
    normalized: string[];
    sequences: ProjectSequences;
}

type ContextCounts = Record<string, Record<string, number>>;
type OrderIndex = Record<number, ContextCounts>;
const MAX_PROJECT_DOCUMENT_CHARACTERS = 100_000;
const MAX_PROJECT_TOKENS = 50_000;

export class ProjectContextModel {
    private projectNgrams: Record<string, OrderIndex> = {};
    private fileContents = new Map<string, IndexedDocument>();
    private exactNgrams: Record<string, OrderIndex> = {};
    private vocabulary = new Map<string, Map<string, number>>();
    private tokenCount = 0;

    constructor(
        private maxOrder: number,
        private minOrder = 2
    ) {}

    public addDocument(document: vscode.TextDocument, scope = '') {
        this.removeDocument(document);
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
            scope,
            sequences: new ProjectSequences(text, scan.tokens),
            raw: scan.tokens.map(token => token.value),
            normalized: scan.tokens.map(token => token.normalized)
        };
        const key = document.uri.toString();
        if (indexed.raw.length > MAX_PROJECT_TOKENS) return;
        while (this.tokenCount + indexed.raw.length > MAX_PROJECT_TOKENS || this.fileContents.size >= 128) {
            const oldest = this.fileContents.keys().next().value;
            if (oldest === undefined) break;
            this.removeByKey(oldest);
        }
        this.fileContents.set(key, indexed);
        this.tokenCount += indexed.raw.length;
        this.updateNgramsForFile(indexed, 1);
    }

    public removeDocument(document: vscode.TextDocument) {
        this.removeByKey(document.uri.toString());
    }

    private removeByKey(key: string) {
        const indexed = this.fileContents.get(key);
        if (indexed) {
            this.updateNgramsForFile(indexed, -1);
            this.tokenCount -= indexed.raw.length;
            this.fileContents.delete(key);
        }
    }

    public updateDocument(document: vscode.TextDocument, scope = '') {
        this.addDocument(document, scope);
    }

    private updateNgramsForFile(indexed: IndexedDocument, delta: 1 | -1) {
        const key = JSON.stringify([indexed.scope, indexed.extension]);
        const words = this.vocabulary.get(key) ?? new Map<string, number>();
        this.vocabulary.set(key, words);
        for (const word of indexed.raw) {
            if (!/^(?:r#)?[A-Za-z_$][A-Za-z0-9_$]*$/.test(word)) continue;
            const count = (words.get(word) ?? 0) + delta;
            if (count > 0) words.set(word, count);
            else words.delete(word);
        }
        if (words.size === 0) this.vocabulary.delete(key);
        this.updateIndex(this.projectNgrams, key, indexed.normalized, indexed.raw, delta);
        this.updateIndex(this.exactNgrams, key, indexed.raw, indexed.raw, delta);
    }

    private updateIndex(index: Record<string, OrderIndex>, key: string, contextTokens: string[], raw: string[], delta: number) {
        const extensionIndex = index[key] ??= Object.create(null) as OrderIndex;
        for (let order = this.minOrder; order <= this.maxOrder; order++) {
            const orderIndex = extensionIndex[order] ??= Object.create(null) as ContextCounts;
            for (let i = 0; i <= raw.length - order; i++) {
                const context = contextTokens.slice(i, i + order - 1);
                const nextToken = raw[i + order - 1];
                const contextKey = serializeContext(context);
                const counts = orderIndex[contextKey] ??= Object.create(null) as Record<string, number>;
                counts[nextToken] = (counts[nextToken] ?? 0) + delta;
                if (counts[nextToken] <= 0) {
                    delete counts[nextToken];
                }
                if (Object.keys(counts).length === 0) {
                    delete orderIndex[contextKey];
                }
            }
            if (Object.keys(orderIndex).length === 0) delete extensionIndex[order];
        }
        if (Object.keys(extensionIndex).length === 0) delete index[key];
    }

    public generateProjectSuggestions(
        normalizedContext: string[],
        languageExtensions: string[],
        maxSuggestions: number,
        minConfidence: number,
        scope = '',
        rawContext: string[] = [],
        prefix = ''
    ): Suggestion[] {
        const scores = new Map<string, Suggestion>();

        for (const exact of [true, false]) {
            const context = exact ? rawContext : normalizedContext;
            for (const extension of languageExtensions) {
                const key = JSON.stringify([scope, extension]);
                const extensionIndex = (exact ? this.exactNgrams : this.projectNgrams)[key];
                if (!extensionIndex) {
                    continue;
                }
                for (let order = this.maxOrder; order >= this.minOrder; order--) {
                    if (context.length < order - 1 || (exact && order < 3)) {
                        continue;
                    }
                    const contextKey = serializeContext(
                        context.slice(-(order - 1))
                    );
                    const nextTokens = extensionIndex[order]?.[contextKey];
                    if (!nextTokens) {
                        continue;
                    }
                    const total = Object.values(nextTokens).reduce((sum, count) => sum + count, 0);
                    if (total <= 0) {
                        continue;
                    }
                    const backoffWeight = Math.pow(exact ? 0.92 : 0.65, this.maxOrder - order);
                    for (const [token, count] of Object.entries(nextTokens)) {
                        if (prefix && (!token.startsWith(prefix) || token === prefix)) continue;
                        const confidence = (count / total) * backoffWeight * (exact ? 1.5 : 0.9);
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
        }

        return Array.from(scores.values())
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxSuggestions);
    }

    public generatePrefixSuggestions(prefix: string, extensions: string[], scope = '', limit = 5): Suggestion[] {
        if (!prefix) return [];
        const counts = new Map<string, number>();
        for (const extension of extensions) {
            for (const [word, count] of this.vocabulary.get(JSON.stringify([scope, extension])) ?? []) {
                if (word.startsWith(prefix) && word.length > prefix.length) {
                    counts.set(word, (counts.get(word) ?? 0) + count);
                }
            }
        }
        return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, limit).map(([token, count]) => ({
                token, confidence: 0.2 + Math.min(0.1, Math.log2(count + 1) / 100),
                source: 'project', order: 1
            }));
    }

    public generateSequenceSuggestions(raw: string[], prefix: string, extensions: string[], scope: string,
        maxTokens: number, shouldStop: () => boolean): Suggestion[] {
        const candidates = new Map<string, Suggestion>();
        for (const indexed of [...this.fileContents.values()].reverse()) {
            if (shouldStop()) break;
            if (indexed.scope !== scope || !extensions.includes(indexed.extension)) continue;
            for (const match of indexed.sequences.find(raw, prefix, maxTokens, shouldStop)) {
                const candidate: Suggestion = { token: match.text, source: 'project',
                    confidence: match.matchedTokens + Math.min(match.tokenCount, 12) / 100,
                    order: match.matchedTokens + 1, leadingSpace: match.leadingSpace };
                const existing = candidates.get(match.text);
                if (!existing || candidate.confidence > existing.confidence) candidates.set(match.text, candidate);
            }
        }
        return [...candidates.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
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
        this.exactNgrams = {};
        this.vocabulary.clear();
        this.tokenCount = 0;
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
