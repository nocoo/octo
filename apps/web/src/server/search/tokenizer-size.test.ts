import { describe, expect, it } from "vitest";
import { indexText, segmentText, tokenizeQuery } from "./tokenizer";

describe("word index input bounds", () => {
	it("keeps a valid diverse Han body inside the D1 row budget without truncation", () => {
		let seed = 7;
		const text = Array.from({ length: 320_000 }, () => {
			seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
			return String.fromCharCode(0x4e00 + (seed % 20_992));
		}).join("");
		const encoder = new TextEncoder();
		expect(encoder.encode(text).length).toBe(960_000);
		const indexed = indexText(text);
		expect(encoder.encode(indexed).length).toBeLessThan(1_900_000);
		const terms = new Set(indexed.split(" "));
		expect([...new Set(text)].every((character) => terms.has(character))).toBe(true);
		expect(
			segmentText(text)
				.slice(-32)
				.every((word) => terms.has(word)),
		).toBe(true);
	});

	it("does not multiply valid source size by compatibility normalization", () => {
		const text = "\ufdfa".repeat(320_000);
		expect(new TextEncoder().encode(text).length).toBe(960_000);
		expect(new TextEncoder().encode(indexText(text)).length).toBeLessThan(1_900_000);
		expect(tokenizeQuery("\ufdfa")).toEqual(["\ufdfa"]);
	});
});
