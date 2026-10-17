export async function probeD1(db: D1Database): Promise<boolean> {
	try {
		const row = await db.prepare("SELECT 1 AS n").first<{ n: number }>();
		return row?.n === 1;
	} catch {
		return false;
	}
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
