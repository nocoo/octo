import { describe, expect, it } from "vitest";
import { bytesToHex, hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "./crypto";

describe("crypto helpers", () => {
	it("hex-encodes array buffers", () => {
		expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
		expect(bytesToHex(new Uint8Array([1]).buffer)).toBe("01");
	});

	it("hashes sha256", async () => {
		const hex = await sha256Hex(new TextEncoder().encode("abc"));
		expect(hex).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});

	it("computes hmac-sha256 hex", async () => {
		const sig = await hmacSha256Hex("secret", "att/mem/a|123");
		expect(sig).toHaveLength(64);
		expect(sig).toMatch(/^[0-9a-f]+$/);
	});

	it("compares hex in constant time", () => {
		expect(timingSafeEqualHex("aa", "aa")).toBe(true);
		expect(timingSafeEqualHex("aa", "ab")).toBe(false);
		expect(timingSafeEqualHex("a", "aa")).toBe(false);
	});
});
