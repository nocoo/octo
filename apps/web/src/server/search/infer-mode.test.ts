import { describe, expect, it } from "vitest";
import { inferSearchMode } from "./infer-mode";

describe("inferSearchMode", () => {
	it("respects explicit mode and payload shape", () => {
		expect(inferSearchMode({ query: "a", mode: "vector" })).toBe("vector");
		expect(inferSearchMode({ query: "a", vector: { profile: "p", values: [1] } })).toBe("hybrid");
		expect(inferSearchMode({ vector: { profile: "p", values: [1] } })).toBe("vector");
		expect(inferSearchMode({ query: "a" })).toBe("fts");
	});
});
