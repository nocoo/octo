import { describe, expect, it } from "vitest";
import {
	completeIdempotencyRecord,
	purgeIdempotencyOlderThan,
	releaseIdempotencyClaim,
} from "./idempotency-repo";

describe("completeIdempotencyRecord", () => {
	it("throws when the pending row is missing", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ run: async () => ({ success: true, meta: { changes: 0 } }) }),
			}),
		} as unknown as D1Database;
		await expect(completeIdempotencyRecord(db, "k", "i", "h", 200, "{}")).rejects.toThrow(
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
