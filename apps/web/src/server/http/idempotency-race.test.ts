import { describe, expect, it } from "vitest";
import { findIdempotencyRecord, insertIdempotencyRecord } from "./idempotency-repo";

describe("idempotency race handling", () => {
	it("returns false when the insert conflicts", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ run: async () => ({ success: false, meta: { changes: 0 } }) }),
			}),
		} as unknown as D1Database;
		const ok = await insertIdempotencyRecord(db, {
			key_id: "k",
			idem_key: "i",
			request_hash: "h",
			status: 200,
			response_json: "{}",
			created_at: 1,
		});
		expect(ok).toBe(false);
	});

	it("loads stored records", async () => {
		const row = {
			key_id: "k",
			idem_key: "i",
			request_hash: "h",
			status: 200,
			response_json: "{}",
			created_at: 1,
		};
		const db = {
			prepare: () => ({
				bind: () => ({ first: async () => row }),
			}),
		} as unknown as D1Database;
		expect(await findIdempotencyRecord(db, "k", "i")).toEqual(row);
	});
});
