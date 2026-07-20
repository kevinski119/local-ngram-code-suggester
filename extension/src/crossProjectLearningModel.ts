import { Suggestion } from './interfaces/suggestion';
import { scanText } from './lexicalScanner';
import { serializeContext } from './utils/utils';

export const CROSS_PROJECT_STATE_KEY = 'crossProjectLearning.v2';

interface StateStore {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): PromiseLike<void>;
}

interface LearnedToken {
    projects: Record<string, number>;
}

type LearnedContexts = Record<string, Record<string, LearnedToken>>;
type LearnedOrders = Record<string, LearnedContexts>;

interface LearnedState {
    version: 2;
    orders: Record<string, LearnedOrders>;
}

const EMPTY_STATE: LearnedState = { version: 2, orders: {} };
const MAX_CONTEXTS_PER_SCOPE = 1_000;
const MAX_CONTRIBUTION_PER_PROJECT = 3;
const PYTHON_STANDARD_LIBRARY = new Set([
    'asyncio', 'collections', 'dataclasses', 'datetime', 'functools', 'hashlib',
    'itertools', 'json', 'logging', 'math', 'os', 'pathlib', 're', 'sys',
    'tempfile', 'time', 'typing', 'unittest',
]);

export function detectExternalLibraries(text: string, languageId: string): string[] {
    const libraries = new Set<string>();
    const add = (name: string) => {
        const normalized = name.trim().toLowerCase();
        if (normalized) libraries.add(normalized);
    };
    if (languageId === 'python') {
        for (const match of text.matchAll(
            /^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)/gm
        )) {
            if (!PYTHON_STANDARD_LIBRARY.has(match[1].toLowerCase())) add(match[1]);
        }
    } else if (['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue']
        .includes(languageId)) {
        for (const match of text.matchAll(
            /(?:from\s+|require\s*\(\s*)["']([^"']+)["']/g
        )) {
            const packageName = match[1].startsWith('@')
                ? match[1].split('/').slice(0, 2).join('/')
                : match[1].split('/')[0];
            if (!packageName.startsWith('.') && !packageName.startsWith('node:')) {
                add(packageName);
            }
        }
    } else if (languageId === 'java') {
        for (const match of text.matchAll(/^\s*import\s+([A-Za-z_][\w.]*)/gm)) {
            const parts = match[1].split('.');
            if (!['java', 'javax'].includes(parts[0])) {
                add(parts.slice(0, Math.min(2, parts.length)).join('.'));
            }
        }
    } else if (['csharp', 'razor', 'aspnetcorerazor'].includes(languageId)) {
        for (const match of text.matchAll(/^\s*using\s+([A-Za-z_][\w.]*)/gm)) {
            const root = match[1].split('.')[0];
            if (root !== 'System') add(root);
        }
    }
    return Array.from(libraries).sort().slice(0, 12);
}

export class CrossProjectLearningModel {
    private state: LearnedState;

    constructor(
        private store: StateStore,
        private minOrder = 2,
        private maxOrder = 4
    ) {
        this.state = store.get<LearnedState>(
            CROSS_PROJECT_STATE_KEY,
            { version: EMPTY_STATE.version, orders: {} }
        );
    }

    public async observe(
        text: string,
        languageId: string,
        extension: string,
        projectFingerprint: string
    ): Promise<void> {
        if (!projectFingerprint || text.length > 500_000) return;
        const tokens = scanText(text, languageId).tokens;
        if (tokens.length < this.minOrder) return;
        const rawFrequency = new Map<string, number>();
        const externalLibraries = detectExternalLibraries(text, languageId);
        for (const token of tokens) {
            rawFrequency.set(token.value, (rawFrequency.get(token.value) ?? 0) + 1);
        }

        for (let order = this.minOrder; order <= this.maxOrder; order++) {
            for (let index = 0; index <= tokens.length - order; index++) {
                const next = tokens[index + order - 1];
                const previous = tokens[index + order - 2];
                if (
                    next.kind === 'identifier' &&
                    (rawFrequency.get(next.value) ?? 0) < 2 &&
                    previous.value !== '.'
                ) {
                    continue;
                }
                const contextKey = serializeContext(
                    tokens
                        .slice(index, index + order - 1)
                        .map(token => token.normalized)
                );
                const scopes = next.kind === 'identifier' && externalLibraries.length > 0
                    ? externalLibraries.map(library => `${extension}|library:${library}`)
                    : [extension];
                for (const scope of scopes) {
                    const scopeOrders = this.state.orders[scope] ??= {};
                    const contexts = scopeOrders[String(order)] ??= {};
                    if (!contexts[contextKey]) {
                        const contextCount = Object.values(scopeOrders).reduce(
                            (sum, values) => sum + Object.keys(values).length,
                            0
                        );
                        if (contextCount >= MAX_CONTEXTS_PER_SCOPE) continue;
                        contexts[contextKey] = {};
                    }
                    const learned = contexts[contextKey][next.value] ??= {
                        projects: {}
                    };
                    learned.projects[projectFingerprint] = Math.min(
                        (learned.projects[projectFingerprint] ?? 0) + 1,
                        MAX_CONTRIBUTION_PER_PROJECT
                    );
                }
            }
        }
        await this.store.update(CROSS_PROJECT_STATE_KEY, this.state);
    }

    public generateSuggestions(
        normalizedContext: string[],
        languageExtensions: string[],
        currentProjectFingerprint: string,
        maxSuggestions: number,
        externalLibraries: string[] = []
    ): Suggestion[] {
        const scores = new Map<string, Suggestion>();
        for (const extension of languageExtensions) {
            const scopes = [
                extension,
                ...externalLibraries.map(library => `${extension}|library:${library}`)
            ];
            for (const scope of scopes) {
                const orders = this.state.orders[scope];
                if (!orders) continue;
                for (let order = this.maxOrder; order >= this.minOrder; order--) {
                if (normalizedContext.length < order - 1) continue;
                const contextKey = serializeContext(
                    normalizedContext.slice(-(order - 1))
                );
                const learnedTokens = orders[String(order)]?.[contextKey];
                if (!learnedTokens) continue;

                const eligible = Object.entries(learnedTokens).filter(([, learned]) =>
                    Object.keys(learned.projects).length >= 2
                );
                const total = eligible.reduce(
                    (sum, [, learned]) =>
                        sum + this.countOutsideProject(
                            learned,
                            currentProjectFingerprint
                        ),
                    0
                );
                if (total <= 0) continue;
                const backoffWeight = Math.pow(0.65, this.maxOrder - order);
                for (const [token, learned] of eligible) {
                    const count = this.countOutsideProject(
                        learned,
                        currentProjectFingerprint
                    );
                    if (count <= 0) continue;
                    const confidence = (count / total) * backoffWeight * 0.3;
                    const existing = scores.get(token);
                    if (!existing || confidence > existing.confidence) {
                        scores.set(token, {
                            token,
                            confidence,
                            source: 'learned',
                            order
                        });
                    }
                }
            }
            }
        }
        return Array.from(scores.values())
            .sort((left, right) => right.confidence - left.confidence)
            .slice(0, maxSuggestions);
    }

    public async clear(): Promise<void> {
        this.state = { version: 2, orders: {} };
        await this.store.update(CROSS_PROJECT_STATE_KEY, this.state);
    }

    public getStats(): { contexts: number; projects: number } {
        const projects = new Set<string>();
        let contexts = 0;
        for (const orders of Object.values(this.state.orders)) {
            for (const learnedContexts of Object.values(orders)) {
                contexts += Object.keys(learnedContexts).length;
                for (const learnedTokens of Object.values(learnedContexts)) {
                    for (const learned of Object.values(learnedTokens)) {
                        Object.keys(learned.projects).forEach(project => projects.add(project));
                    }
                }
            }
        }
        return { contexts, projects: projects.size };
    }

    private countOutsideProject(
        learned: LearnedToken,
        currentProjectFingerprint: string
    ): number {
        return Object.entries(learned.projects).reduce(
            (sum, [project, count]) =>
                project === currentProjectFingerprint ? sum : sum + count,
            0
        );
    }
}
