import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import {
	decodeIdempotencyResponse,
	encodeIdempotencyResponse,
	IDEMPOTENCY_MAX_RESPONSE_BYTES,
} from "./idempotency-storage";

describe("idempotency response storage", () => {
	it("round-trips small bodies verbatim", () => {
		const body = '{"results":[{"ok":true}]}';
		expect(decodeIdempotencyResponse(encodeIdempotencyResponse(body))).toBe(body);
	});

	it("chunks large bodies and reassembles on decode", () => {
		const body = `{"data":"${"y".repeat(500_000)}"}`;
		const stored = encodeIdempotencyResponse(body);
		expect(stored.includes("_chunks")).toBe(true);
		expect(decodeIdempotencyResponse(stored)).toBe(body);
	});

	it("returns stored json bodies that are not chunk envelopes", () => {
		const stored = '{"ok":true,"nested":{"a":1}}';
		expect(decodeIdempotencyResponse(stored)).toBe(stored);
	});

	it("rejects bodies above the storage limit", () => {
		const huge = "z".repeat(IDEMPOTENCY_MAX_RESPONSE_BYTES + 1);
		expect(() => encodeIdempotencyResponse(huge)).toThrow(ApiError);
		expect(() => encodeIdempotencyResponse(huge)).toThrow(/too large/);
	});
});
