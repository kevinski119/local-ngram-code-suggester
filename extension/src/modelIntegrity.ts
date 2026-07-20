import * as crypto from 'crypto';

function sortRecursively(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortRecursively);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
                .map(([key, child]) => [key, sortRecursively(child)])
        );
    }
    return value;
}

export function computeModelChecksum(model: Record<string, unknown>): string {
    const payload = { ...model };
    delete payload.checksum_sha256;
    const canonical = JSON.stringify(sortRecursively(payload));
    return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

export function verifyModelChecksum(model: Record<string, unknown>): boolean {
    const expected = model.checksum_sha256;
    return typeof expected !== 'string' ||
        computeModelChecksum(model).toLowerCase() === expected.toLowerCase();
}
