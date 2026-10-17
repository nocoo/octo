import { describe, expect, it } from "vitest";
import { parseIdempotencyKey } from "./idempotency-key";

describe("parseIdempotencyKey", () => {
	it("accepts printable ascii keys", () => {
		expect(parseIdempotencyKey("mig-123")).toBe("mig-123");
	});

	it("rejects empty and non-printable keys", () => {
		expect(() => parseIdempotencyKey("")).toThrow(/invalid Idempotency-Key/);
		expect(() => parseIdempotencyKey("a\nb")).toThrow(/invalid Idempotency-Key/);
		expect(() => parseIdempotencyKey("a".repeat(129))).toThrow(/invalid Idempotency-Key/);
	});
});
