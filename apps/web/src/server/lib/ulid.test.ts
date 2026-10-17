import { describe, expect, it } from "vitest";
import { newUlid } from "./ulid";

describe("newUlid", () => {
	it("returns a 26-character crockford id", () => {
		const id = newUlid(1_700_000_000_000);
		expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(newUlid()).not.toBe(newUlid());
	});
});
