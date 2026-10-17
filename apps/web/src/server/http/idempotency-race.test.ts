import { describe, expect, it } from "vitest";
import { claimIdempotencyKey, findIdempotencyRecord } from "./idempotency-repo";
import { IDEMPOTENCY_PENDING_STATUS } from "./idempotency-storage";

describe("idempotency race handling", () => {
	it("returns conflict when a conflicting insert leaves no row", async () => {
		const db = {
			prepare: (sql: string) => {
				if (sql.startsWith("INSERT")) {
					return {
						bind: () => ({ run: async () => ({ success: false, meta: { changes: 0 } }) }),
					};
				}
				if (sql.startsWith("SELECT")) {
					return {
						bind: () => ({ first: async () => null }),
					};
				}
				throw new Error(sql);
			},
		} as unknown as D1Database;
		const claim = await claimIdempotencyKey(db, "k", "i", "h", 1);
		expect(claim.kind).toBe("conflict");
	});

	it("returns in_progress when the insert loses the race with the same hash", async () => {
		const row = {
			key_id: "k",
			idem_key: "i",
			request_hash: "h",
			status: IDEMPOTENCY_PENDING_STATUS,
			response_json: "",
			created_at: 1,
		};
		const db = {
			prepare: (sql: string) => {
				if (sql.startsWith("INSERT")) {
					return {
						bind: () => ({ run: async () => ({ success: true, meta: { changes: 0 } }) }),
					};
				}
				if (sql.startsWith("SELECT")) {
					return {
						bind: () => ({ first: async () => row }),
					};
				}
				throw new Error(sql);
			},
		} as unknown as D1Database;
		const claim = await claimIdempotencyKey(db, "k", "i", "h", 1);
		expect(claim.kind).toBe("in_progress");
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
