import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "./base64url";

describe("base64url", () => {
	it("round-trips bytes", () => {
		const raw = new TextEncoder().encode('{"s":1}');
		expect(base64UrlDecode(base64UrlEncode(raw))).toEqual(raw);
	});
});
