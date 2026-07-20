import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { CodeSuggester } from './codeSuggester';
import { InstalledPack, PACK_STATE_KEY } from './packTypes';

interface PackCatalogEntry {
    id: string;
    name: string;
    version: string;
    languages: string[];
    url: string;
    sha256: string;
    size?: number;
    license?: string;
    sources?: string[];
}

interface PackCatalog {
    schemaVersion: 1;
    packs: PackCatalogEntry[];
}

const MAX_PACK_BYTES = 256 * 1024 * 1024;

export class LanguagePackManager {
    constructor(
        private context: vscode.ExtensionContext,
        private suggester: CodeSuggester
    ) {}

    public getInstalledPacks(): InstalledPack[] {
        return this.context.globalState.get<InstalledPack[]>(PACK_STATE_KEY, []);
    }

    public async manage() {
        const installed = this.getInstalledPacks();
        const choices: vscode.QuickPickItem[] = [
            {
                label: '$(cloud-download) Install from catalog',
                description: 'Download a free pack after confirmation'
            },
            {
                label: '$(folder-opened) Install from file',
                description: 'Import a local .json or .json.gz model'
            },
            ...installed.map(pack => ({
                label: `$(package) ${pack.name}`,
                description: `${pack.version} • ${pack.languages.join(', ')}`,
                detail: pack.id
            }))
        ];
        const selection = await vscode.window.showQuickPick(choices, {
            title: 'Manage Local N-Gram Language Packs',
            placeHolder: 'Install, activate, or remove a pack'
        });
        if (!selection) return;

        if (selection.label.includes('Install from catalog')) {
            await this.installFromCatalog();
        } else if (selection.label.includes('Install from file')) {
            await this.installFromFile();
        } else if (selection.detail) {
            const pack = installed.find(item => item.id === selection.detail);
            if (pack) await this.manageInstalledPack(pack);
        }
    }

    public async checkForUpdates(showNoUpdates = true) {
        const catalog = await this.fetchCatalog();
        if (!catalog) return;
        const installed = this.getInstalledPacks();
        const updates = catalog.packs.filter(candidate => {
            const current = installed.find(pack => pack.id === candidate.id);
            return current && current.version !== candidate.version;
        });
        if (updates.length === 0) {
            if (showNoUpdates) {
                vscode.window.showInformationMessage('All Local N-Gram language packs are current.');
            }
            return;
        }
        const selected = await vscode.window.showQuickPick(
            updates.map(pack => ({
                label: pack.name,
                description: `${pack.version} • ${pack.languages.join(', ')}`,
                detail: pack.id
            })),
            { title: 'Language Pack Updates', canPickMany: true }
        );
        if (!selected) return;
        for (const item of selected) {
            const entry = updates.find(pack => pack.id === item.detail);
            if (entry) await this.downloadAndInstall(entry);
        }
    }

    private async installFromCatalog() {
        const catalog = await this.fetchCatalog();
        if (!catalog) return;
        const selected = await vscode.window.showQuickPick(
            catalog.packs.map(pack => ({
                label: pack.name,
                description: `${pack.version} • ${pack.languages.join(', ')}`,
                detail: pack.id
            })),
            { title: 'Install Local N-Gram Language Pack' }
        );
        const pack = catalog.packs.find(candidate => candidate.id === selected?.detail);
        if (!pack) return;
        const size = pack.size ? ` (${(pack.size / 1024 / 1024).toFixed(1)} MB)` : '';
        const approval = await vscode.window.showInformationMessage(
            `Download ${pack.name}${size} from ${new URL(pack.url).host}?`,
            { modal: true },
            'Download'
        );
        if (approval === 'Download') {
            await this.downloadAndInstall(pack);
        }
    }

    private async installFromFile() {
        const selection = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'N-Gram models': ['json', 'gz'] },
            title: 'Select a Local N-Gram v3 model'
        });
        if (!selection?.[0]) return;
        const source = selection[0].fsPath;
        const model = await this.suggester.readAndValidateModelFile(source);
        if ((model.format_version ?? 2) < 3) {
            throw new Error('Language packs must use model format v3.');
        }
        const id = path.basename(source).toLowerCase().replace(/[^a-z0-9.-]/g, '-');
        await this.installFile(source, {
            id,
            name: id,
            version: model.version,
            languages: model.file_extensions,
            url: '',
            sha256: await this.sha256(source)
        });
    }

    private async downloadAndInstall(pack: PackCatalogEntry) {
        this.validateCatalogEntry(pack);
        const response = await fetch(pack.url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) {
            throw new Error(`Pack download failed with HTTP ${response.status}.`);
        }
        const contentLength = Number(response.headers.get('content-length') ?? 0);
        if (contentLength > MAX_PACK_BYTES) {
            throw new Error('Language pack exceeds the 256 MB safety limit.');
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > MAX_PACK_BYTES) {
            throw new Error('Language pack exceeds the 256 MB safety limit.');
        }
        await fs.promises.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
        const temporary = path.join(
            this.context.globalStorageUri.fsPath,
            `${pack.id}.${Date.now()}.download`
        );
        await fs.promises.writeFile(temporary, bytes, { flag: 'wx' });
        try {
            const digest = await this.sha256(temporary);
            if (digest.toLowerCase() !== pack.sha256.toLowerCase()) {
                throw new Error('Language pack checksum verification failed.');
            }
            await this.suggester.readAndValidateModelFile(temporary);
            await this.installFile(temporary, pack);
        } finally {
            await fs.promises.rm(temporary, { force: true });
        }
    }

    private async installFile(source: string, pack: PackCatalogEntry) {
        this.validatePackId(pack.id);
        await fs.promises.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
        const extension = (
            source.toLowerCase().endsWith('.gz') ||
            pack.url.toLowerCase().endsWith('.gz')
        ) ? '.json.gz' : '.json';
        const version = pack.version.toLowerCase().replace(/[^a-z0-9.-]/g, '-');
        const destination = path.join(
            this.context.globalStorageUri.fsPath,
            `${pack.id}-${version}-${Date.now()}${extension}`
        );
        const temporary = `${destination}.tmp`;
        await fs.promises.copyFile(source, temporary);
        await fs.promises.rename(temporary, destination);

        const installed: InstalledPack = {
            id: pack.id,
            name: pack.name,
            version: pack.version,
            languages: pack.languages,
            path: destination,
            sha256: pack.sha256,
            sourceUrl: pack.url || undefined
        };
        const previous = this.getInstalledPacks().find(item => item.id === installed.id);
        const next = this.getInstalledPacks().filter(item => item.id !== installed.id);
        next.push(installed);
        await this.context.globalState.update(PACK_STATE_KEY, next);
        if (previous && previous.path !== destination) {
            const configuredPath = vscode.workspace
                .getConfiguration('codeSuggester')
                .get<string>('modelPath');
            if (configuredPath === previous.path) {
                await vscode.workspace
                    .getConfiguration('codeSuggester')
                    .update('modelPath', destination, vscode.ConfigurationTarget.Global);
            }
            await fs.promises.rm(previous.path, { force: true });
        }
        await this.suggester.reloadModel();
        vscode.window.showInformationMessage(`${installed.name} ${installed.version} installed.`);
    }

    private async manageInstalledPack(pack: InstalledPack) {
        const action = await vscode.window.showQuickPick(
            [
                {
                    label: '$(settings) Use as custom model',
                    description: 'Give this pack precedence over other installed packs'
                },
                { label: '$(trash) Remove', description: 'Delete this installed pack' }
            ],
            { title: pack.name }
        );
        if (action?.label.includes('custom model')) {
            await vscode.workspace
                .getConfiguration('codeSuggester')
                .update('modelPath', pack.path, vscode.ConfigurationTarget.Global);
        } else if (action?.label.includes('Remove')) {
            const configuration = vscode.workspace.getConfiguration('codeSuggester');
            if (configuration.get<string>('modelPath') === pack.path) {
                await configuration.update(
                    'modelPath',
                    undefined,
                    vscode.ConfigurationTarget.Global
                );
            }
            await fs.promises.rm(pack.path, { force: true });
            await this.context.globalState.update(
                PACK_STATE_KEY,
                this.getInstalledPacks().filter(item => item.id !== pack.id)
            );
            await this.suggester.reloadModel();
            vscode.window.showInformationMessage(`${pack.name} removed.`);
        }
    }

    private async fetchCatalog(): Promise<PackCatalog | undefined> {
        const catalogUrl = vscode.workspace
            .getConfiguration('codeSuggester')
            .get<string>('languagePacks.catalogUrl', '');
        if (!catalogUrl) {
            vscode.window.showInformationMessage(
                'No language-pack catalog is configured. You can still install a local model file.'
            );
            return undefined;
        }
        if (new URL(catalogUrl).protocol !== 'https:') {
            throw new Error('Language-pack catalogs must use HTTPS.');
        }
        const response = await fetch(catalogUrl, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) {
            throw new Error(`Pack catalog request failed with HTTP ${response.status}.`);
        }
        const catalog = await response.json() as PackCatalog;
        if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.packs)) {
            throw new Error('Unsupported language-pack catalog format.');
        }
        catalog.packs.forEach(pack => this.validateCatalogEntry(pack));
        return catalog;
    }

    private validateCatalogEntry(pack: PackCatalogEntry) {
        this.validatePackId(pack.id);
        if (!pack.name || !pack.version || !Array.isArray(pack.languages)) {
            throw new Error(`Language-pack catalog entry ${pack.id} is incomplete.`);
        }
        if (new URL(pack.url).protocol !== 'https:') {
            throw new Error(`Language pack ${pack.id} must use HTTPS.`);
        }
        if (!/^[a-fA-F0-9]{64}$/.test(pack.sha256)) {
            throw new Error(`Language pack ${pack.id} has an invalid SHA-256 value.`);
        }
    }

    private validatePackId(id: string) {
        if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(id) || id.includes('..')) {
            throw new Error(`Unsafe language-pack identifier: ${id}`);
        }
    }

    private async sha256(filepath: string): Promise<string> {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filepath);
        for await (const chunk of stream) {
            hash.update(chunk as Buffer);
        }
        return hash.digest('hex');
    }
}
