export interface Suggestion {
    token: string;
    confidence: number;
    source?: 'global' | 'project' | 'learned';
    order?: number;
    prefix?: string;
    acceptanceKey?: string;
    leadingSpace?: boolean;
}
