import { describe, expect, it } from "vitest";
import { tokenizeQuery } from "./tokenizer";

describe("tokenizeQuery edge cases", () => {
	it("handles empty input", () => {
		expect(tokenizeQuery("   ")).toEqual([]);
	});
});
