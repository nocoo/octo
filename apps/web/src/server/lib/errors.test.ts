import { describe, expect, it } from "vitest";
import { ApiError, errorEnvelope, jsonError, jsonOk, toErrorResponse } from "./errors";

describe("error envelope", () => {
	it("omits details when they are null", () => {
		expect(errorEnvelope("not_found", "missing", "req-1")).toEqual({
			error: { code: "not_found", message: "missing", request_id: "req-1" },
		});
	});

	it("includes details when present", () => {
		expect(errorEnvelope("validation_failed", "bad", "req-2", { issues: [] })).toEqual({
			error: {
				code: "validation_failed",
				message: "bad",
				details: { issues: [] },
				request_id: "req-2",
			},
		});
	});
});

describe("responses", () => {
	it("serializes jsonError and jsonOk", async () => {
		const err = jsonError("unavailable", "d1 down", "r3");
		expect(err.status).toBe(503);
		expect(await err.json()).toEqual({
			error: { code: "unavailable", message: "d1 down", request_id: "r3" },
		});
		expect(await jsonOk({ ok: true }).json()).toEqual({ ok: true });
		const ok = jsonOk({ ok: true }, 201, { "cache-control": "no-store" });
		expect(ok.status).toBe(201);
		expect(ok.headers.get("cache-control")).toBe("no-store");
		expect(await ok.json()).toEqual({ ok: true });
	});

	it("maps ApiError and unknown errors", async () => {
		const custom = new ApiError("internal", "x", { why: 1 }, 599);
		expect(custom.status).toBe(599);
		expect(custom.details).toEqual({ why: 1 });
		const mapped = toErrorResponse(new ApiError("forbidden", "no"), "r4");
		expect(mapped.status).toBe(403);
		expect(await mapped.json()).toMatchObject({
			error: { code: "forbidden", request_id: "r4" },
		});
		const fallback = toErrorResponse(new Error("boom"), "r5");
		expect(fallback.status).toBe(500);
		expect(await fallback.json()).toMatchObject({
			error: { code: "internal", message: "internal error", request_id: "r5" },
		});
	});
});
