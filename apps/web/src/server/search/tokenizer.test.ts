import { describe, expect, it } from "vitest";
import { buildFtsMatchQuery, tokenizeQuery } from "./tokenizer";

describe("tokenizeQuery", () => {
	it("splits mixed Chinese and punctuation", () => {
		expect(tokenizeQuery("部署 cloudflare worker")).toEqual({
			longTerms: ["cloudflare", "worker"],
			shortTerms: ["部署"],
			allShort: false,
		});
	});

	it("marks all-short queries", () => {
		expect(tokenizeQuery("部署 cf")).toEqual({
			longTerms: [],
			shortTerms: ["部署", "cf"],
			allShort: true,
		});
	});

	it("keeps short terms when long terms exist", () => {
		expect(tokenizeQuery("ab 三个字")).toEqual({
			longTerms: ["三个字"],
			shortTerms: ["ab"],
			allShort: false,
		});
	});
});

describe("buildFtsMatchQuery", () => {
	it("joins long terms with OR and quotes", () => {
		expect(buildFtsMatchQuery(["cloudflare", "三个字"])).toBe('"cloudflare" OR "三个字"');
	});

	it("returns null when empty", () => {
		expect(buildFtsMatchQuery([])).toBeNull();
	});
});
