import { describe, expect, it } from "vitest";
import { ERROR_CODES, errorCodeSchema, HTTP_STATUS_BY_CODE } from "./errors";

describe("error codes", () => {
	it("parses every documented code", () => {
		for (const code of ERROR_CODES) {
			expect(errorCodeSchema.parse(code)).toBe(code);
			expect(HTTP_STATUS_BY_CODE[code]).toBeGreaterThanOrEqual(400);
		}
	});

	it("rejects unknown codes", () => {
		expect(errorCodeSchema.safeParse("method_not_allowed").success).toBe(false);
	});
});
