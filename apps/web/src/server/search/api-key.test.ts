import { describe, expect, it } from "vitest";
import { constantTimeEqual, hmacSecretHash, parseBearerToken } from "./api-key";

describe("parseBearerToken", () => {
	it("parses octo keys", () => {
		expect(parseBearerToken("Bearer octo_abcdefghijkl_mnopqrstuvwxyzabcdefgh")).toEqual({
			keyId: "abcdefghijkl",
			secret: "mnopqrstuvwxyzabcdefgh",
		});
	});

	it("rejects invalid headers", () => {
		expect(parseBearerToken(undefined)).toBeNull();
		expect(parseBearerToken("Basic x")).toBeNull();
		expect(parseBearerToken("Bearer ")).toBeNull();
	});
});

describe("hmacSecretHash", () => {
	it("is deterministic", async () => {
		const a = await hmacSecretHash("pepper", "secret");
		const b = await hmacSecretHash("pepper", "secret");
		expect(a).toBe(b);
		expect(a).toHaveLength(64);
	});
});

describe("constantTimeEqual", () => {
	it("compares strings", () => {
		expect(constantTimeEqual("abc", "abc")).toBe(true);
		expect(constantTimeEqual("abc", "abd")).toBe(false);
		expect(constantTimeEqual("a", "ab")).toBe(false);
	});
});
