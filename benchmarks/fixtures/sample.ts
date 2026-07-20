export function sum(values: number[]): number {
    let total = 0;
    for (const value of values) {
        total += value;
    }
    return total;
}

export async function loadValue(): Promise<number> {
    const response = await Promise.resolve(42);
    return response;
}
