import { describe, expect, it } from "vitest";
import { capVectorTopK, VECTOR_TOPK_NO_METADATA, VECTOR_TOPK_WITH_METADATA } from "./types";

describe("capVectorTopK", () => {
	it("caps by metadata mode", () => {
		expect(capVectorTopK(200, false)).toBe(VECTOR_TOPK_NO_METADATA);
		expect(capVectorTopK(200, true)).toBe(VECTOR_TOPK_WITH_METADATA);
		expect(capVectorTopK(10, false)).toBe(10);
	});
});
