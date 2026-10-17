import { describe, expect, it } from "vitest";
import { newUlid } from "./id";

describe("newUlid", () => {
	it("returns 26 crockford chars", () => {
		const id = newUlid(1_700_000_000_000);
		expect(id).toHaveLength(26);
		expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});
});
