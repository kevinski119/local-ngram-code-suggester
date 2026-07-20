import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { createHash } from 'crypto';
import * as vscode from 'vscode';
import * as zlib from 'zlib';

import {
    CrossProjectLearningModel,
    detectExternalLibraries
} from './crossProjectLearningModel';
import { CodeModel } from './interfaces/codeModel';
import { Suggestion } from './interfaces/suggestion';
import { normalizeToken, scanText } from './lexicalScanner';
import { getLanguageProfile } from './languageProfiles';
import { verifyModelChecksum } from './modelIntegrity';
import {
    formatTokenSequence,
    generateBackoffSuggestions,
    isPlausibleTokenTransition,
    shouldPreferPythonBlockBoundary,
    shouldSuppressAfterLineBoundary
} from './ngramEngine';
import { InstalledPack, PACK_STATE_KEY } from './packTypes';
import { ProjectContextModel } from './projectContextModel';
import {
    EXTENSION_TO_LANGUAGE,
    LANGUAGE_EXTENSIONS,
    LANGUAGE_ID_TO_EXTENSION
} from './utils/constants';

interface PerformanceOptions {
    latencyMs: number;
    beamWidth: number;
    maxTokens: number;
    continuationMinConfidence: number;
}

export interface SuggesterDiagnostics {
    modelVersion: string;
    formatVersion: number;
    tokenizerProfileVersion: string;
    modelSource: string;
    patterns: number;
    languages: string[];
    loadTimeMs: number;
    lastLatencyMs: number;
    p95LatencyMs: number;
    cacheHitRate: number;
    cacheEntries: number;
    projectFiles: number;
    learnedContexts: number;
    learnedProjects: number;
}

interface Beam {
    tokens: string[];
    normalized: string[];
    score: number;
}

interface LoadedModel {
    model: CodeModel;
    source: string;
    custom: boolean;
}

const MAX_MODEL_BYTES = 512 * 1024 * 1024;

export class CodeSuggester implements vscode.Disposable {
    public model: CodeModel | null = null;
    public isModelLoaded = false;
    public projectModel = new ProjectContextModel(6);
    public readonly ready: Promise<boolean>;

    private documentListeners: vscode.Disposable[] = [];
    private loadedModels: LoadedModel[] = [];
    private loadGeneration = 0;
    private modelSource = 'none';
    private loadTimeMs = 0;
    private recentLatencies: number[] = [];
    private lastLatencyMs = 0;
    private cacheHits = 0;
    private cacheMisses = 0;
    private suggestionCache = new Map<string, Suggestion[]>();
    private prefixIndex = new Map<string, Map<string, string[]>>();
    private pendingDocumentUpdates = new Map<string, NodeJS.Timeout>();
    private crossProjectModel: CrossProjectLearningModel;

    constructor(private context: vscode.ExtensionContext) {
        this.crossProjectModel = new CrossProjectLearningModel(context.globalState);
        this.setupDocumentListeners();
        this.ready = this.loadModel(false);
    }

    private async loadModel(showSuccessMessage = true): Promise<boolean> {
        const started = performance.now();
        const generation = ++this.loadGeneration;
        const config = vscode.workspace.getConfiguration('codeSuggester');
        const configuredPath = config.get<string>('modelPath', './models/model.json.gz');
        const modelPathInspection = config.inspect<string>('modelPath');
        const hasCustomModelPath = Boolean(
            modelPathInspection?.globalValue ??
            modelPathInspection?.workspaceValue ??
            modelPathInspection?.workspaceFolderValue
        );
        if (!configuredPath) {
            vscode.window.showWarningMessage('Local N-Gram model path is not configured.');
            return false;
        }

        try {
            const resolvedPath = this.resolveModelPath(configuredPath);
            if (!resolvedPath) {
                throw new Error(`Model file was not found: ${configuredPath}`);
            }
            const stats = await fs.promises.stat(resolvedPath);
            if (stats.size > MAX_MODEL_BYTES) {
                throw new Error('Model exceeds the 512 MB safety limit.');
            }
            const model = await this.readModelFile(resolvedPath);
            this.validateModel(model);
            const loadedModels: LoadedModel[] = [
                { model, source: resolvedPath, custom: hasCustomModelPath }
            ];
            const displaySources = [
                hasCustomModelPath
                    ? `Custom model: ${path.basename(resolvedPath)}`
                    : 'Bundled starter model'
            ];
            for (const pack of this.context.globalState.get<InstalledPack[]>(PACK_STATE_KEY, [])) {
                if (!fs.existsSync(pack.path) || path.resolve(pack.path) === path.resolve(resolvedPath)) {
                    continue;
                }
                try {
                    const packModel = await this.readModelFile(pack.path);
                    this.validateModel(packModel);
                    loadedModels.push({ model: packModel, source: pack.path, custom: false });
                    displaySources.push(`Language pack: ${pack.name} ${pack.version}`);
                } catch (error) {
                    console.warn(`Skipping invalid language pack ${pack.id}:`, error);
                }
            }
            if (generation !== this.loadGeneration) {
                return false;
            }

            this.model = model;
            this.loadedModels = loadedModels;
            this.rebuildPrefixIndex();
            this.modelSource = displaySources.join('; ');
            this.isModelLoaded = true;
            this.loadTimeMs = performance.now() - started;
            this.suggestionCache.clear();
            this.projectModel = new ProjectContextModel(
                Math.max(...loadedModels.map(item => item.model.max_order ?? item.model.n)),
                Math.min(...loadedModels.map(item => item.model.min_order ?? 2))
            );
            this.reloadProjectContext();

            if (showSuccessMessage) {
                vscode.window.showInformationMessage(
                    `Local N-Gram loaded ${model.total_patterns.toLocaleString()} patterns ` +
                    `in ${this.loadTimeMs.toFixed(0)} ms.`
                );
            }
            return true;
        } catch (error) {
            if (generation !== this.loadGeneration) {
                return false;
            }
            this.model = null;
            this.loadedModels = [];
            this.isModelLoaded = false;
            const message = error instanceof Error ? error.message : String(error);
            console.error('Error loading Local N-Gram model:', error);
            vscode.window.showErrorMessage(`Failed to load Local N-Gram model: ${message}`);
            return false;
        }
    }

    private setupDocumentListeners() {
        if (this.useProjectContext()) {
            this.reloadProjectContext();
        }
        this.documentListeners.push(
            vscode.workspace.onDidOpenTextDocument(document => {
                if (this.useProjectContext() && this.isDocumentSafeToLearn(document)) {
                    this.projectModel.addDocument(document);
                }
            }),
            vscode.workspace.onDidCloseTextDocument(document => {
                if (this.useProjectContext()) {
                    this.projectModel.removeDocument(document);
                }
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                const config = vscode.workspace.getConfiguration('codeSuggester');
                if (
                    this.useProjectContext() &&
                    config.get<boolean>('updateOnFileChange', false)
                ) {
                    const key = event.document.uri.toString();
                    const pending = this.pendingDocumentUpdates.get(key);
                    if (pending) clearTimeout(pending);
                    this.pendingDocumentUpdates.set(key, setTimeout(() => {
                        this.pendingDocumentUpdates.delete(key);
                        if (this.isDocumentSafeToLearn(event.document)) {
                            this.projectModel.updateDocument(event.document);
                        }
                        this.suggestionCache.clear();
                    }, 250));
                }
            }),
            vscode.workspace.onDidSaveTextDocument(document => {
                if (this.useProjectContext() && this.isDocumentSafeToLearn(document)) {
                    this.projectModel.updateDocument(document);
                }
                const config = vscode.workspace.getConfiguration('codeSuggester');
                if (
                    config.get<boolean>('crossProjectLearning', true) &&
                    this.isDocumentSafeToLearn(document)
                ) {
                    const extension = this.getFileExtension(document);
                    const fingerprint = this.getProjectFingerprint(document);
                    if (extension && fingerprint) {
                        void this.crossProjectModel.observe(
                            document.getText(),
                            document.languageId,
                            extension,
                            fingerprint
                        ).then(() => this.suggestionCache.clear());
                    }
                }
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('codeSuggester.modelPath')) {
                    void this.reloadModel();
                } else if (event.affectsConfiguration('codeSuggester.useProjectContext')) {
                    if (this.useProjectContext()) {
                        this.reloadProjectContext();
                    } else {
                        this.clearProjectContext();
                    }
                } else if (event.affectsConfiguration('codeSuggester')) {
                    this.suggestionCache.clear();
                }
            })
        );
    }

    private resolveModelPath(modelPath: string): string | null {
        if (path.isAbsolute(modelPath)) {
            return fs.existsSync(modelPath) ? modelPath : null;
        }
        for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
            const candidate = path.join(workspaceFolder.uri.fsPath, modelPath);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        const extensionCandidate = path.join(this.context.extensionPath, modelPath);
        return fs.existsSync(extensionCandidate) ? extensionCandidate : null;
    }

    public async readAndValidateModelFile(filepath: string): Promise<CodeModel> {
        const model = await this.readModelFile(filepath);
        this.validateModel(model);
        return model;
    }

    private async readModelFile(filepath: string): Promise<CodeModel> {
        const data = await fs.promises.readFile(filepath);
        const isCompressed = data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
        const payload = isCompressed
            ? await new Promise<Buffer>((resolve, reject) =>
                zlib.gunzip(
                    data,
                    { maxOutputLength: MAX_MODEL_BYTES },
                    (error, result) => error ? reject(error) : resolve(result)
                )
            )
            : data;
        return JSON.parse(payload.toString('utf-8')) as CodeModel;
    }

    private validateModel(value: unknown): asserts value is CodeModel {
        if (!value || typeof value !== 'object') {
            throw new Error('Model root must be a JSON object.');
        }
        const model = value as Partial<CodeModel>;
        if (!Number.isInteger(model.n) || (model.n ?? 0) < 2 || (model.n ?? 0) > 12) {
            throw new Error('Model "n" must be an integer from 2 through 12.');
        }
        if ((model.format_version ?? 2) >= 3) {
            if (!model.orders || typeof model.orders !== 'object') {
                throw new Error('Model v3 is missing the "orders" object.');
            }
        } else if (!model.ngrams || typeof model.ngrams !== 'object') {
            throw new Error('Legacy model is missing the "ngrams" object.');
        }
        if (
            !Array.isArray(model.file_extensions) ||
            !model.file_extensions.every(extension => typeof extension === 'string')
        ) {
            throw new Error('Model "file_extensions" must be an array of strings.');
        }
        if (!Number.isFinite(model.total_patterns) || (model.total_patterns ?? -1) < 0) {
            throw new Error('Model "total_patterns" must be a non-negative number.');
        }
        if (
            (model.format_version ?? 2) >= 3 &&
            !verifyModelChecksum(model as unknown as Record<string, unknown>)
        ) {
            throw new Error('Model checksum verification failed.');
        }
        const datasets: unknown[] = [];
        if ((model.format_version ?? 2) >= 3) {
            for (const orders of Object.values(model.orders ?? {})) {
                if (!orders || typeof orders !== 'object') {
                    throw new Error('Model order data must be an object.');
                }
                for (const [order, contexts] of Object.entries(orders)) {
                    const numericOrder = Number(order);
                    if (!Number.isInteger(numericOrder) || numericOrder < 2 || numericOrder > 12) {
                        throw new Error(`Model contains unsupported n-gram order: ${order}.`);
                    }
                    datasets.push(contexts);
                }
            }
        } else {
            datasets.push(...Object.values(model.ngrams ?? {}));
        }
        for (const dataset of datasets) {
            if (!dataset || typeof dataset !== 'object') {
                throw new Error('Model context data must be an object.');
            }
            for (const [contextKey, counts] of Object.entries(
                dataset as Record<string, unknown>
            )) {
                let context: unknown;
                try {
                    context = JSON.parse(contextKey);
                } catch {
                    throw new Error('Model contains an invalid serialized context.');
                }
                if (!Array.isArray(context) || !context.every(token => typeof token === 'string')) {
                    throw new Error('Model contexts must contain only string tokens.');
                }
                if (!counts || typeof counts !== 'object') {
                    throw new Error('Model next-token counts must be objects.');
                }
                for (const count of Object.values(counts as Record<string, unknown>)) {
                    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
                        throw new Error('Model token counts must be non-negative finite numbers.');
                    }
                }
            }
        }
    }

    public getSuggestions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const result = this.createSuggestions(document, position, false);
        return result.map((suggestion, index) => {
            const item = new vscode.CompletionItem(
                this.displayToken(suggestion.token),
                vscode.CompletionItemKind.Text
            );
            const source = suggestion.source === 'project'
                ? 'Project'
                : suggestion.source === 'learned'
                    ? 'Cross-project'
                    : 'Global';
            item.detail = `${source} • order ${suggestion.order ?? '?'} • ` +
                `${(suggestion.confidence * 100).toFixed(1)}%`;
            item.sortText = index.toString().padStart(5, '0');
            item.insertText = this.prepareInsertion(
                suggestion.token,
                document,
                position,
                suggestion.prefix
            );
            return item;
        });
    }

    public getInlineSuggestions(
        document: vscode.TextDocument,
        position: vscode.Position,
        cancellationToken?: vscode.CancellationToken
    ): vscode.InlineCompletionItem[] {
        return this.createSuggestions(document, position, true, cancellationToken).map(suggestion =>
            new vscode.InlineCompletionItem(
                this.prepareInsertion(
                    suggestion.token,
                    document,
                    position,
                    suggestion.prefix
                ),
                new vscode.Range(position, position)
            )
        );
    }

    private createSuggestions(
        document: vscode.TextDocument,
        position: vscode.Position,
        allowMultiToken: boolean,
        cancellationToken?: vscode.CancellationToken
    ): Suggestion[] {
        if (!this.model || cancellationToken?.isCancellationRequested) {
            return [];
        }
        const started = performance.now();
        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const scan = scanText(text, document.languageId, text.length);
        const config = vscode.workspace.getConfiguration('codeSuggester');
        if (
            (!scan.cursorInSupportedRegion ||
                (scan.cursorInComment &&
                    !config.get<boolean>('suggestInComments', false)))
        ) {
            return [];
        }

        const extension = this.getFileExtension(document);
        const languageExtensions = this.getLanguageExtensions(extension);
        if (!languageExtensions) {
            return [];
        }
        const raw = scan.tokens.map(token => token.value);
        const normalized = scan.tokens.map(token => token.normalized);
        const finalToken = scan.tokens.at(-1);
        const currentLinePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const profile = getLanguageProfile(document.languageId, text);
        const currentLineTokens = scanText(currentLinePrefix, profile.id).tokens
            .map(token => token.value);
        if (
            shouldSuppressAfterLineBoundary(
                currentLinePrefix,
                finalToken?.value,
                profile.statementBoundaries
            )
        ) {
            return [];
        }
        const activePrefix = finalToken?.kind === 'identifier' && finalToken.end === text.length
            ? finalToken.value
            : undefined;
        const contextRaw = activePrefix ? raw.slice(0, -1) : raw;
        const contextNormalized = activePrefix ? normalized.slice(0, -1) : normalized;
        const options = this.getPerformanceOptions();
        const deadline = started + options.latencyMs;
        let suggestions = this.generateCombinedSuggestions(
            contextRaw,
            contextNormalized,
            languageExtensions,
            config.get<number>('maxSuggestions', 5),
            this.getProjectFingerprint(document),
            detectExternalLibraries(text, document.languageId)
        );
        if (activePrefix) {
            const contextual = suggestions
                .filter(suggestion =>
                    suggestion.token !== '<ID>' &&
                    suggestion.token.startsWith(activePrefix) &&
                    suggestion.token.length > activePrefix.length
                )
                .map(suggestion => ({
                    ...suggestion,
                    confidence: suggestion.confidence * 1.25
                }));
            const prefixFallback = this.generatePrefixFallback(
                activePrefix,
                languageExtensions,
                config.get<number>('maxSuggestions', 5)
            );
            suggestions = this.deduplicateSuggestions([
                ...contextual,
                ...prefixFallback
            ]).slice(0, config.get<number>('maxSuggestions', 5));
        }

        if (
            allowMultiToken &&
            config.get<boolean>('enableMultiToken', true) &&
            options.maxTokens > 1 &&
            performance.now() < deadline &&
            !cancellationToken?.isCancellationRequested
        ) {
            suggestions = this.expandMultiToken(
                suggestions,
                contextRaw,
                contextNormalized,
                languageExtensions,
                options,
                new Set(profile.statementBoundaries),
                profile.id,
                currentLineTokens,
                deadline,
                () => cancellationToken?.isCancellationRequested ?? false
            );
        }
        if (activePrefix) {
            suggestions = suggestions.map(suggestion => ({
                ...suggestion,
                prefix: activePrefix
            }));
        }
        this.recordLatency(performance.now() - started);
        return suggestions;
    }

    private generateCombinedSuggestions(
        raw: string[],
        normalized: string[],
        languageExtensions: string[],
        maxSuggestions: number,
        currentProjectFingerprint: string,
        externalLibraries: string[]
    ): Suggestion[] {
        const config = vscode.workspace.getConfiguration('codeSuggester');
        const minConfidence = config.get<number>('minConfidence', 0.85);
        const global = this.generateGlobalSuggestions(
            raw,
            normalized,
            languageExtensions,
            Math.max(maxSuggestions, 8),
            minConfidence
        );
        const project = this.useProjectContext()
            ? this.projectModel.generateProjectSuggestions(
                normalized,
                languageExtensions,
                Math.max(maxSuggestions, 8),
                Math.max(minConfidence * 0.5, 0.01)
            )
            : [];
        const learned = config.get<boolean>('crossProjectLearning', true)
            ? this.crossProjectModel.generateSuggestions(
                normalized,
                languageExtensions,
                currentProjectFingerprint,
                Math.max(maxSuggestions, 8),
                externalLibraries
            )
            : [];

        const recent = new Set(raw.slice(-200));
        const merged = new Map<string, Suggestion>();
        for (const suggestion of [...global, ...project, ...learned]) {
            const recencyBoost = recent.has(suggestion.token) ? 1.12 : 1;
            const boosted = { ...suggestion, confidence: suggestion.confidence * recencyBoost };
            const existing = merged.get(boosted.token);
            if (!existing || boosted.confidence > existing.confidence) {
                merged.set(boosted.token, boosted);
            }
        }
        return Array.from(merged.values())
            .filter(suggestion => suggestion.token.length > 0)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxSuggestions);
    }

    private deduplicateSuggestions(suggestions: Suggestion[]): Suggestion[] {
        const unique = new Map<string, Suggestion>();
        for (const suggestion of suggestions) {
            const existing = unique.get(suggestion.token);
            if (!existing || suggestion.confidence > existing.confidence) {
                unique.set(suggestion.token, suggestion);
            }
        }
        return Array.from(unique.values()).sort((a, b) => b.confidence - a.confidence);
    }

    private rebuildPrefixIndex() {
        this.prefixIndex.clear();
        for (const loaded of this.loadedModels) {
            for (const [extension, vocabulary] of Object.entries(loaded.model.vocab ?? {})) {
                const extensionIndex = this.prefixIndex.get(extension) ?? new Map<string, string[]>();
                this.prefixIndex.set(extension, extensionIndex);
                for (const token of vocabulary) {
                    if (!/^[A-Za-z_$][A-Za-z0-9_$]+$/.test(token)) continue;
                    for (let length = 1; length <= Math.min(4, token.length); length++) {
                        const prefix = token.slice(0, length);
                        const candidates = extensionIndex.get(prefix) ?? [];
                        if (!candidates.includes(token)) candidates.push(token);
                        extensionIndex.set(prefix, candidates);
                    }
                }
            }
        }
        for (const [extension, extensionIndex] of this.prefixIndex) {
            for (const candidates of extensionIndex.values()) {
                candidates.sort((left, right) =>
                    this.getBundledTokenFrequency(extension, right) -
                        this.getBundledTokenFrequency(extension, left) ||
                    left.length - right.length ||
                    left.localeCompare(right)
                );
            }
        }
    }

    private getBundledTokenFrequency(extension: string, token: string): number {
        return this.loadedModels.reduce(
            (total, loaded) =>
                total + (loaded.model.token_frequencies?.[extension]?.[token] ?? 0),
            0
        );
    }

    private generatePrefixFallback(
        prefix: string,
        languageExtensions: string[],
        maxSuggestions: number
    ): Suggestion[] {
        const candidates = new Map<string, number>();
        const key = prefix.slice(0, 4);
        for (const extension of languageExtensions) {
            for (const token of this.prefixIndex.get(extension)?.get(key) ?? []) {
                if (token.startsWith(prefix) && token.length > prefix.length) {
                    candidates.set(
                        token,
                        Math.max(
                            candidates.get(token) ?? 0,
                            this.getBundledTokenFrequency(extension, token)
                        )
                    );
                }
            }
        }
        return Array.from(candidates)
            .sort(([left, leftFrequency], [right, rightFrequency]) =>
                rightFrequency - leftFrequency ||
                left.length - right.length ||
                left.localeCompare(right)
            )
            .slice(0, maxSuggestions)
            .map(([token, frequency], index) => ({
                token,
                confidence: 0.05 + Math.min(Math.log10(frequency + 1) / 100, 0.03) -
                    index * 0.001,
                source: 'global' as const,
                order: 1
            }));
    }

    private generateGlobalSuggestions(
        raw: string[],
        normalized: string[],
        languageExtensions: string[],
        maxSuggestions: number,
        minConfidence: number
    ): Suggestion[] {
        if (!this.model) {
            return [];
        }
        const model = this.model;
        const formatVersion = model.format_version ?? 2;
        const contextTokens = formatVersion >= 3 && model.normalized_contexts ? normalized : raw;
        const cacheKey = `${this.loadedModels.length}|${formatVersion}|${minConfidence.toFixed(4)}|` +
            `${languageExtensions.join(',')}|` +
            `${raw.slice(-3).join('\u0001')}|` +
            contextTokens.slice(-Math.max(...this.loadedModels.map(
                item => item.model.max_order ?? item.model.n
            ), 6)).join('\u0001');
        const cached = this.suggestionCache.get(cacheKey);
        if (cached) {
            this.cacheHits++;
            return cached.slice(0, maxSuggestions);
        }
        this.cacheMisses++;

        const merged = new Map<string, Suggestion>();
        const customTokens = new Set<string>();
        for (const loaded of this.loadedModels) {
            const relevantExtensions = languageExtensions.filter(extension =>
                loaded.model.file_extensions.includes(extension)
            );
            if (relevantExtensions.length === 0) continue;
            const candidates = [
                ...generateBackoffSuggestions(
                    loaded.model,
                    raw,
                    normalized,
                    relevantExtensions,
                    minConfidence
                ),
                ...this.generateMemberAccessSuggestions(
                    loaded.model,
                    raw,
                    relevantExtensions,
                    minConfidence
                )
            ];
            for (const suggestion of candidates) {
                const existing = merged.get(suggestion.token);
                if (loaded.custom) {
                    merged.set(suggestion.token, suggestion);
                    customTokens.add(suggestion.token);
                } else if (
                    !customTokens.has(suggestion.token) &&
                    (!existing || suggestion.confidence > existing.confidence)
                ) {
                    merged.set(suggestion.token, suggestion);
                }
            }
        }
        const result = Array.from(merged.values())
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, Math.max(maxSuggestions, 20));
        this.cacheSet(cacheKey, result);
        return result.slice(0, maxSuggestions);
    }

    private generateMemberAccessSuggestions(
        model: CodeModel,
        raw: string[],
        languageExtensions: string[],
        minConfidence: number
    ): Suggestion[] {
        if (raw.at(-1) !== '.' || !raw.at(-2)) {
            return [];
        }
        const receiver = raw.at(-2) as string;
        const scores = new Map<string, Suggestion>();
        for (const extension of languageExtensions) {
            const members = model.member_access?.[extension]?.[receiver];
            if (!members) continue;
            const total = Object.values(members).reduce((sum, count) => sum + count, 0);
            if (total <= 0) continue;
            for (const [token, count] of Object.entries(members)) {
                const confidence = 0.75 + 0.25 * (count / total);
                if (confidence < minConfidence) continue;
                scores.set(token, {
                    token,
                    confidence,
                    source: 'global',
                    order: model.max_order ?? model.n
                });
            }
        }
        return Array.from(scores.values()).sort((a, b) => b.confidence - a.confidence);
    }

    private expandMultiToken(
        initial: Suggestion[],
        raw: string[],
        normalized: string[],
        languageExtensions: string[],
        options: PerformanceOptions,
        stopTokens: ReadonlySet<string>,
        profileId: string,
        currentLineTokens: string[],
        deadline: number,
        isCancelled: () => boolean
    ): Suggestion[] {
        let beams: Beam[] = initial.slice(0, options.beamWidth).map(suggestion => ({
            tokens: [suggestion.token],
            normalized: [...normalized, normalizeToken(suggestion.token, languageExtensions[0])],
            score: Math.max(suggestion.confidence, 0.0001)
        }));
        const completed: Beam[] = [];

        for (
            let step = 1;
            step < options.maxTokens && performance.now() < deadline && !isCancelled();
            step++
        ) {
            const nextBeams: Beam[] = [];
            for (const beam of beams) {
                const last = beam.tokens.at(-1);
                if (!last || stopTokens.has(last)) {
                    completed.push(beam);
                    continue;
                }
                let next = this.generateGlobalSuggestions(
                    [...raw, ...beam.tokens],
                    beam.normalized,
                    languageExtensions,
                    options.beamWidth,
                    options.continuationMinConfidence
                ).filter(suggestion =>
                    isPlausibleTokenTransition(last, suggestion.token, profileId)
                );
                if (
                    profileId === 'python' &&
                    shouldPreferPythonBlockBoundary(
                        [...currentLineTokens, ...beam.tokens],
                        last
                    )
                ) {
                    const colon = this.generateGlobalSuggestions(
                        [...raw, ...beam.tokens],
                        beam.normalized,
                        languageExtensions,
                        Math.max(options.beamWidth * 3, 12),
                        0.01
                    ).find(suggestion => suggestion.token === ':');
                    if (colon) {
                        next = [{ ...colon, confidence: Math.max(colon.confidence, 1) }];
                    }
                }
                if (next.length === 0) {
                    completed.push(beam);
                }
                for (const suggestion of next) {
                    nextBeams.push({
                        tokens: [...beam.tokens, suggestion.token],
                        normalized: [
                            ...beam.normalized,
                            normalizeToken(suggestion.token, languageExtensions[0])
                        ],
                        score: beam.score * Math.max(suggestion.confidence, 0.0001)
                    });
                }
            }
            beams = nextBeams
                .sort((a, b) => b.score - a.score)
                .slice(0, options.beamWidth);
            if (beams.length === 0) {
                break;
            }
        }
        completed.push(...beams);
        return completed
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(1, Math.min(initial.length, options.beamWidth)))
            .map(beam => ({
                token: formatTokenSequence(beam.tokens, token => this.displayToken(token)),
                confidence: beam.score,
                source: 'global'
            }));
    }

    private displayToken(token: string): string {
        if (token === '<STR>') return '""';
        if (token === '<NUM>') return '0';
        if (token === '<ID>') return '';
        return token;
    }

    private prepareInsertion(
        token: string,
        document: vscode.TextDocument,
        position: vscode.Position,
        prefix?: string
    ): string {
        const displayed = token.includes(' ')
            ? token
            : this.displayToken(token);
        if (prefix && displayed.startsWith(prefix)) {
            return displayed.slice(prefix.length);
        }
        return this.shouldAddSpaceBeforeSuggestion(document, position)
            ? ` ${displayed}`
            : displayed;
    }

    private getPerformanceOptions(): PerformanceOptions {
        const config = vscode.workspace.getConfiguration('codeSuggester');
        const preset = config.get<string>('performancePreset', 'quality');
        const configuredLatency = config.get<number>('maxLatencyMs', 35);
        const minConfidence = config.get<number>('minConfidence', 0.85);
        const configuredMaxTokens = config.get<number>('maxInlineTokens', 5);
        if (preset === 'fast') {
            return {
                latencyMs: Math.min(configuredLatency, 15),
                beamWidth: 1,
                maxTokens: 1,
                continuationMinConfidence: minConfidence
            };
        }
        if (preset === 'quality') {
            return {
                latencyMs: Math.max(configuredLatency, 60),
                beamWidth: 5,
                maxTokens: Math.max(1, Math.min(configuredMaxTokens, 5)),
                continuationMinConfidence: Math.max(minConfidence * 0.5, 0.15)
            };
        }
        return {
            latencyMs: configuredLatency,
            beamWidth: 3,
            maxTokens: Math.max(1, Math.min(configuredMaxTokens, 3)),
            continuationMinConfidence: Math.max(minConfidence * 0.5, 0.08)
        };
    }

    private cacheSet(key: string, value: Suggestion[]) {
        if (this.suggestionCache.size >= 500) {
            const oldest = this.suggestionCache.keys().next().value as string | undefined;
            if (oldest) this.suggestionCache.delete(oldest);
        }
        this.suggestionCache.set(key, value);
    }

    private recordLatency(duration: number) {
        this.lastLatencyMs = duration;
        this.recentLatencies.push(duration);
        if (this.recentLatencies.length > 200) {
            this.recentLatencies.shift();
        }
    }

    public getDiagnostics(): SuggesterDiagnostics {
        const sorted = [...this.recentLatencies].sort((a, b) => a - b);
        const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
        const accesses = this.cacheHits + this.cacheMisses;
        const project = this.projectModel.getProjectStats();
        const learned = this.crossProjectModel.getStats();
        return {
            modelVersion: this.model?.version ?? 'not loaded',
            formatVersion: this.model?.format_version ?? (this.model ? 2 : 0),
            tokenizerProfileVersion: this.model?.tokenizer_profile_version ?? 'legacy',
            modelSource: this.modelSource,
            patterns: this.loadedModels.reduce(
                (sum, loaded) => sum + loaded.model.total_patterns,
                0
            ),
            languages: Array.from(new Set(this.loadedModels.flatMap(
                loaded => loaded.model.file_extensions
            ))),
            loadTimeMs: this.loadTimeMs,
            lastLatencyMs: this.lastLatencyMs,
            p95LatencyMs: sorted[p95Index] ?? 0,
            cacheHitRate: accesses === 0 ? 0 : this.cacheHits / accesses,
            cacheEntries: this.suggestionCache.size,
            projectFiles: project.files,
            learnedContexts: learned.contexts,
            learnedProjects: learned.projects
        };
    }

    public async reloadModel(): Promise<boolean> {
        this.model = null;
        this.isModelLoaded = false;
        return this.loadModel();
    }

    public clearProjectContext() {
        this.projectModel.clear();
        this.suggestionCache.clear();
        this.prefixIndex.clear();
    }

    public reloadProjectContext() {
        this.projectModel.clear();
        if (this.useProjectContext()) {
            vscode.workspace.textDocuments.forEach(document =>
                this.isDocumentSafeToLearn(document) &&
                    this.projectModel.addDocument(document)
            );
        }
        this.suggestionCache.clear();
    }

    public getProjectContextStats() {
        return this.projectModel.getProjectStats();
    }

    public async clearCrossProjectLearning(): Promise<void> {
        await this.crossProjectModel.clear();
        this.suggestionCache.clear();
    }

    private getFileExtension(document: vscode.TextDocument): string {
        const direct = path.extname(document.fileName).toLowerCase() ||
            LANGUAGE_ID_TO_EXTENSION[document.languageId];
        if (direct) return direct;
        const header = document.getText().slice(0, 256);
        return header.startsWith('#!')
            ? getLanguageProfile(undefined, header).extensions[0]
            : '';
    }

    private getLanguageExtensions(extension: string): string[] | null {
        const canonical = EXTENSION_TO_LANGUAGE[extension];
        return canonical ? LANGUAGE_EXTENSIONS[canonical] ?? [canonical] : null;
    }

    private isDocumentSafeToLearn(document: vscode.TextDocument): boolean {
        return !vscode.languages
            .getDiagnostics(document.uri)
            .some(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error);
    }

    private getProjectFingerprint(document: vscode.TextDocument): string {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!folder) return '';
        return createHash('sha256')
            .update(folder.uri.toString())
            .digest('hex')
            .slice(0, 16);
    }

    private shouldAddSpaceBeforeSuggestion(
        document: vscode.TextDocument,
        position: vscode.Position
    ): boolean {
        const before = document.getText(
            new vscode.Range(new vscode.Position(0, 0), position)
        );
        const lastCharacter = before.trimEnd().slice(-1);
        const lastWord = before.trim().split(/\s+/).pop();
        return (
            lastCharacter === '=' ||
            lastWord === 'new' ||
            lastWord === 'await' ||
            lastWord === 'return'
        ) && !before.endsWith(' ');
    }

    private useProjectContext(): boolean {
        return vscode.workspace
            .getConfiguration('codeSuggester')
            .get<boolean>('useProjectContext', true);
    }

    public dispose() {
        this.loadGeneration++;
        this.documentListeners.forEach(disposable => disposable.dispose());
        this.documentListeners = [];
        this.projectModel.clear();
        this.suggestionCache.clear();
        this.pendingDocumentUpdates.forEach(timeout => clearTimeout(timeout));
        this.pendingDocumentUpdates.clear();
    }
}
