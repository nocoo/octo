import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import {
	chunkRowIdemKey,
	IDEMPOTENCY_CHUNK_MARKER_PREFIX,
	IDEMPOTENCY_CHUNK_STATUS,
	loadIdempotencyResponse,
	planIdempotencyResponseStorage,
} from "./idempotency-storage";

describe("idempotency response storage", () => {
	it("round-trips small bodies inline", () => {
		const body = '{"results":[{"ok":true}]}';
		const planned = planIdempotencyResponseStorage(body);
		expect(planned.kind).toBe("inline");
		if (planned.kind === "inline") {
			expect(planned.body).toBe(body);
		}
	});

	it("plans multiple chunk rows for large bodies", () => {
		const body = "y".repeat(1_600_000);
		const planned = planIdempotencyResponseStorage(body);
		expect(planned.kind).toBe("chunked");
		if (planned.kind === "chunked") {
			expect(planned.chunks.length).toBeGreaterThan(1);
			expect(planned.marker).toBe(`${IDEMPOTENCY_CHUNK_MARKER_PREFIX}${planned.chunks.length}`);
			expect(planned.chunks.join("")).toBe(body);
		}
	});

	it("loads chunked rows from D1", async () => {
		const body = `{"data":"${"z".repeat(900_000)}"}`;
		const planned = planIdempotencyResponseStorage(body);
		expect(planned.kind).toBe("chunked");
		if (planned.kind !== "chunked") {
			return;
		}
		const rows = new Map<string, string>();
		for (let i = 0; i < planned.chunks.length; i += 1) {
			rows.set(chunkRowIdemKey("idem", i), planned.chunks[i] ?? "");
		}
		const db = {
			prepare: () => ({
				bind: (_keyId: string, idemKey: string) => ({
					first: async () => {
						const chunk = rows.get(idemKey);
						return chunk === undefined ? null : { response_json: chunk };
					},
				}),
			}),
		} as unknown as D1Database;
		const loaded = await loadIdempotencyResponse(db, "kid", "idem", planned.marker);
		expect(loaded).toBe(body);
	});

	it("rejects corrupt chunk markers", async () => {
		const db = {
			prepare: () => ({ bind: () => ({ first: async () => null }) }),
		} as unknown as D1Database;
		await expect(loadIdempotencyResponse(db, "k", "i", "@octo/chunks:bad")).rejects.toBeInstanceOf(
			ApiError,
		);
	});

	it("uses chunk row status constant", () => {
		expect(IDEMPOTENCY_CHUNK_STATUS).toBe(-2);
	});

	it("fails when a chunk row is missing during load", async () => {
		const planned = planIdempotencyResponseStorage("a".repeat(900_000));
		if (planned.kind !== "chunked") {
			throw new Error("expected chunked plan");
		}
		const db = {
			prepare: () => ({
				bind: () => ({ first: async () => null }),
			}),
		} as unknown as D1Database;
		await expect(loadIdempotencyResponse(db, "k", "i", planned.marker)).rejects.toBeInstanceOf(
			ApiError,
		);
	});
});
