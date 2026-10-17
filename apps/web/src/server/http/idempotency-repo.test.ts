import { describe, expect, it } from "vitest";
import {
	completeIdempotencyRecord,
	purgeIdempotencyOlderThan,
	releaseIdempotencyClaim,
} from "./idempotency-repo";

describe("completeIdempotencyRecord", () => {
	it("stores chunked responses in multiple rows", async () => {
		const runs: string[] = [];
		const db = {
			prepare: (sql: string) => ({
				bind: (..._args: Array<string | number>) => ({
					run: async () => {
						runs.push(sql.slice(0, 12));
						return { success: true, meta: { changes: 1 } };
					},
				}),
			}),
			batch: async (statements: Array<{ run: () => Promise<{ meta: { changes: number } }> }>) => {
				const results = [];
				for (const statement of statements) {
					results.push(await statement.run());
				}
				return results;
			},
		} as unknown as D1Database;
		await completeIdempotencyRecord(db, "k", "i", "h", 200, "x".repeat(900_000), 1);
		expect(runs.some((sql) => sql.startsWith("INSERT"))).toBe(true);
		expect(runs.some((sql) => sql.startsWith("UPDATE"))).toBe(true);
	});

	it("stores inline responses", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }),
			}),
			batch: async () => [{ meta: { changes: 1 } }],
		} as unknown as D1Database;
		await expect(
			completeIdempotencyRecord(db, "k", "i", "h", 200, '{"ok":true}', 1),
		).resolves.toBeUndefined();
	});

	it("throws when the pending row is missing", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ run: async () => ({ success: true, meta: { changes: 0 } }) }),
			}),
			batch: async () => [{ meta: { changes: 0 } }],
		} as unknown as D1Database;
		await expect(completeIdempotencyRecord(db, "k", "i", "h", 200, "{}", 1)).rejects.toThrow(
			/completion lost race/,
		);
	});
});

describe("releaseIdempotencyClaim", () => {
	it("deletes pending rows", async () => {
		let deleted = false;
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					run: async () => {
						if (sql.startsWith("DELETE")) {
							deleted = true;
						}
						return { success: true, meta: { changes: 1 } };
					},
				}),
			}),
		} as unknown as D1Database;
		await releaseIdempotencyClaim(db, "k", "i", "h");
		expect(deleted).toBe(true);
	});

	it("stops deleting chunk rows when none remain", async () => {
		let deleteRuns = 0;
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					run: async () => {
						if (sql.startsWith("DELETE")) {
							deleteRuns += 1;
							return {
								success: true,
								meta: { changes: deleteRuns === 1 ? 1 : 0 },
							};
						}
						return { success: true, meta: { changes: 0 } };
					},
				}),
			}),
		} as unknown as D1Database;
		await releaseIdempotencyClaim(db, "k", "i", "h");
		expect(deleteRuns).toBe(2);
	});
});

describe("claimIdempotencyKey", () => {
	it("interprets existing rows when insert throws", async () => {
		const { claimIdempotencyKey: claim } = await import("./idempotency-repo");
		const db = {
			prepare: (sql: string) => {
				if (sql.startsWith("INSERT")) {
					return {
						bind: () => ({
							run: async () => {
								throw new Error("unique");
							},
						}),
					};
				}
				if (sql.startsWith("SELECT")) {
					return {
						bind: () => ({
							first: async () => ({
								key_id: "k",
								idem_key: "i",
								request_hash: "h",
								status: 201,
								response_json: '{"ok":true}',
								created_at: 1,
							}),
						}),
					};
				}
				throw new Error(sql);
			},
		} as unknown as D1Database;
		await expect(claim(db, "k", "i", "h", 2)).resolves.toEqual({
			kind: "replay",
			status: 201,
			body: '{"ok":true}',
		});
	});
});

describe("purgeIdempotencyOlderThan", () => {
	it("returns deleted row count", async () => {
		const run = { success: true, meta: { changes: 3 } };
		const db = {
			prepare: () => ({
				bind: () => ({ run: async () => run }),
			}),
		} as unknown as D1Database;
		expect(await purgeIdempotencyOlderThan(db, 1)).toBe(3);
	});
});
