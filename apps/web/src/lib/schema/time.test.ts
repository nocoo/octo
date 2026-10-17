import { describe, expect, it } from "vitest";
import { isoUtcDateTimeSchema } from "./time";

describe("isoUtcDateTimeSchema", () => {
	it("accepts Z timestamps and rejects offsets", () => {
		expect(isoUtcDateTimeSchema.parse("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
		expect(isoUtcDateTimeSchema.safeParse("2026-01-01T00:00:00+00:00").success).toBe(false);
	});
});
