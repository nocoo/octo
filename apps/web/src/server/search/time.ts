export function msToIso(ms: number): string {
	return new Date(ms).toISOString();
}

export function isoToMs(iso: string): number {
	return Date.parse(iso);
}
