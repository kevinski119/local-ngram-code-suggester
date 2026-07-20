export interface InstalledPack {
    id: string;
    name: string;
    version: string;
    languages: string[];
    path: string;
    sha256: string;
    sourceUrl?: string;
}

export const PACK_STATE_KEY = 'codeSuggester.installedLanguagePacks';
