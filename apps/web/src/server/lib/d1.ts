export const D1_MAX_BOUND_PARAMS = 100;

export function chunkBoundParams<T>(items: readonly T[]): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += D1_MAX_BOUND_PARAMS) {
		chunks.push(items.slice(i, i + D1_MAX_BOUND_PARAMS));
	}
	return chunks;
}

export function d1Results<T>(row: { results?: T[] } | null | undefined): T[] {
	if (row?.results) {
		return row.results;
	}
	return [];
}

export async function probeD1(db: D1Database): Promise<boolean> {
	try {
		const row = await db.prepare("SELECT 1 AS n").first<{ n: number }>();
		return row?.n === 1;
	} catch {
		return false;
	}
}

export function isUniqueConstraint(err: unknown, table: string): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return /UNIQUE constraint failed/i.test(msg) && msg.includes(table);
}

export async function readTestMarker(db: D1Database): Promise<string | null> {
	try {
		const row = await db
			.prepare("SELECT value FROM _test_marker WHERE key = ?")
			.bind("env")
			.first<{ value: string }>();
		return row?.value === "test" ? "test" : null;
	} catch {
		return null;
	}
}
