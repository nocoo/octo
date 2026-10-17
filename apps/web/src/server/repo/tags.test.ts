import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { normalizeTag, tagDisplayName } from "./tags";

describe("normalizeTag", () => {
	it("trims, applies NFKC, and lowercases latin only", () => {
		expect(normalizeTag("  Infra  ")).toBe("infra");
		expect(normalizeTag("Caddy")).toBe("caddy");
		expect(normalizeTag("运维")).toBe("运维");
		expect(normalizeTag("  标签A  ")).toBe("标签a");
		expect(normalizeTag("ﬁle")).toBe("file");
	});

	it("rejects empty and overlong names", () => {
		expect(() => normalizeTag("   ")).toThrow(ApiError);
		expect(() => normalizeTag("")).toThrow(ApiError);
		expect(() => normalizeTag("x".repeat(65))).toThrow(ApiError);
		expect(normalizeTag("x".repeat(64))).toBe("x".repeat(64));
	});
});

describe("tagDisplayName", () => {
	it("preserves latin case after trim and NFKC", () => {
		expect(tagDisplayName("  Infra  ")).toBe("Infra");
		expect(tagDisplayName("ﬁle")).toBe("file");
	});
});
