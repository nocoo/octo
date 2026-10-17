import { describe, expect, it } from "vitest";
import { hmacSha256Base64Url, sha256Hex, timingSafeEqual } from "./crypto";

describe("crypto helpers", () => {
	it("hashes and compares safely", async () => {
		const hash = await sha256Hex("abc");
		expect(hash).toHaveLength(64);
		const mac = await hmacSha256Base64Url("secret", "msg");
		expect(mac.length).toBeGreaterThan(10);
		expect(timingSafeEqual("a", "a")).toBe(true);
		expect(timingSafeEqual("a", "b")).toBe(false);
		expect(timingSafeEqual("ab", "a")).toBe(false);
	});
});
