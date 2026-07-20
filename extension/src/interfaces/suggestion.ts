export interface Suggestion {
    token: string;
    confidence: number;
    source?: 'global' | 'project'; // Suggest source
    order?: number;
    prefix?: string;
}
