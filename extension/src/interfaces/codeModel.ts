export interface CodeModel {
    version: string;
    n: number;
    format_version?: number;
    min_order?: number;
    max_order?: number;
    normalized_contexts?: boolean;
    tokenizer_profile_version?: string;
    checksum_sha256?: string;
    string_table?: string[];
    language_ids?: Record<string, string[]>;
    ngrams?: {
        [extension: string]: {
            [context: string]: { [token: string]: number }
        }
    };
    orders?: {
        [extension: string]: {
            [order: string]: {
                [context: string]: { [token: string]: number }
            }
        }
    };
    vocab?: { [extension: string]: string[] };
    file_extensions: string[];
    total_patterns: number;
    smoothing?: string;
    alpha?: number;
    corpus?: {
        sources?: string[];
        license?: string;
    };
}
