import { LANGUAGE_PROFILES } from '../languageProfiles';

export const LANGUAGE_EXTENSIONS: Record<string, string[]> = Object.fromEntries(
    LANGUAGE_PROFILES.flatMap(profile =>
        profile.extensions.map(extension => [extension, profile.extensions])
    )
);

export const EXTENSION_TO_LANGUAGE: Record<string, string> = Object.fromEntries(
    LANGUAGE_PROFILES.flatMap(profile =>
        profile.extensions.map(extension => [extension, profile.extensions[0]])
    )
);

export const LANGUAGE_ID_TO_EXTENSION: Record<string, string> = Object.fromEntries(
    LANGUAGE_PROFILES.flatMap(profile =>
        profile.languageIds.map(languageId => [languageId, profile.extensions[0]])
    )
);

export const SUPPORTED_LANGUAGE_IDS = Array.from(
    new Set(LANGUAGE_PROFILES.flatMap(profile => profile.languageIds))
);
