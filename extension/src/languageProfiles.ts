import profilesData from './languageProfiles.json';

export interface BlockCommentDefinition {
    start: string;
    end: string;
    nested?: boolean;
}

export interface StringDefinition {
    start: string;
    end: string;
    escape?: string;
    multiline?: boolean;
    caseInsensitive?: boolean;
}

export interface EmbeddedRegionDefinition {
    host: string;
    start: string;
    startEnd?: string;
    end: string;
}

export interface LanguageProfile {
    id: string;
    languageIds: string[];
    extensions: string[];
    lineComments: string[];
    blockComments: BlockCommentDefinition[];
    strings: StringDefinition[];
    statementBoundaries: string[];
    keywords: string[];
    shebangs?: string[];
    embeddedRegions?: EmbeddedRegionDefinition[];
}

interface LanguageProfileFile {
    version: string;
    profiles: LanguageProfile[];
}

const data = profilesData as LanguageProfileFile;

export const TOKENIZER_PROFILE_VERSION = data.version;
export const LANGUAGE_PROFILES = data.profiles;

export function getLanguageProfile(languageIdOrExtension?: string, text = ''): LanguageProfile {
    const key = languageIdOrExtension?.toLowerCase();
    if (key) {
        const direct = LANGUAGE_PROFILES.find(profile =>
            profile.id === key ||
            profile.languageIds.includes(key) ||
            profile.extensions.includes(key.startsWith('.') ? key : `.${key}`)
        );
        if (direct) {
            return direct;
        }
    }

    if (text.startsWith('#!')) {
        const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : undefined);
        const shebangProfile = LANGUAGE_PROFILES.find(profile =>
            profile.shebangs?.some(marker => firstLine.toLowerCase().includes(marker))
        );
        if (shebangProfile) {
            return shebangProfile;
        }
    }

    return LANGUAGE_PROFILES.find(profile => profile.id === 'typescript') ?? LANGUAGE_PROFILES[0];
}

