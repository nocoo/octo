import { describe, expect, it } from "vitest";
import { purgeIdempotencyOlderThan } from "./idempotency-repo";

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
