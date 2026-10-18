import { vi } from "vitest";

const originals = new WeakMap<D1Database, D1Database["batch"]>();

export function spyBusinessBatch(db: D1Database) {
	const original = originals.get(db) ?? db.batch.bind(db);
	originals.set(db, original);
	const business = vi.fn(original);
	vi.spyOn(db, "batch").mockImplementation((statements) => {
		const first = statements[0] as unknown as { sql: string } | undefined;
		return first?.sql.trimStart().startsWith("INSERT INTO audit_log")
			? original(statements)
			: business(statements);
	});
	return business;
}
