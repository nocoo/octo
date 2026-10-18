import { describe, expect, it } from "vitest";
import { buildFtsMatchQuery, tokenizeQuery } from "./tokenizer";

describe("tokenizeQuery", () => {
	it.each([
		{ query: "what does he drink in the morning", longTerms: ["drink", "morning"] },
		{ query: "how often are keys rotated", longTerms: ["often", "keys", "rotated"] },
		{ query: "WHAT Does HE drink IN THE morning", longTerms: ["drink", "morning"] },
	])("removes English function words from $query", ({ query, longTerms }) => {
		expect(tokenizeQuery(query)).toEqual({ longTerms, shortTerms: [], allShort: false });
	});

	it("keeps the original terms when every term is an English stopword", () => {
		expect(tokenizeQuery("what is it")).toEqual({
			longTerms: ["what"],
			shortTerms: ["is", "it"],
			allShort: false,
		});
		expect(tokenizeQuery("he in")).toEqual({
			longTerms: [],
			shortTerms: ["he", "in"],
			allShort: true,
		});
	});

	it("preserves CJK, mixed-script tokens and meaningful short English terms", () => {
		expect(tokenizeQuery("what 早上 喝 什么 the密钥 cf")).toEqual({
			longTerms: ["the密钥"],
			shortTerms: ["早上", "喝", "什么", "cf"],
			allShort: false,
		});
		expect(tokenizeQuery("密钥 多久 轮换")).toEqual({
			longTerms: [],
			shortTerms: ["密钥", "多久", "轮换"],
			allShort: true,
		});
	});

	it("counts only marks removed by FTS without normalizing the original terms", () => {
		expect(tokenizeQuery("e\u0301t")).toEqual({
			longTerms: [],
			shortTerms: ["e\u0301t"],
			allShort: true,
		});
		expect(tokenizeQuery("e\u0301t e\u0301ta ét étab 가나다 가나 가ᄂ 𠮷野 𠮷野家")).toEqual({
			longTerms: ["e\u0301ta", "étab", "가나다", "가ᄂ", "𠮷野家"],
			shortTerms: ["e\u0301t", "ét", "가나", "𠮷野"],
			allShort: false,
		});
	});

	it("retains combining marks that SQLite does not remove", () => {
		const terms = ["e\u0345t", "e\u0363t", "e\u1ab0t", "e\u1dc0t", "e\u20d0t", "e\ufe20t", "किता"];
		expect(tokenizeQuery(terms.join(" "))).toEqual({
			longTerms: terms,
			shortTerms: [],
			allShort: false,
		});
	});
	it("counts supplementary CJK code points for short, mixed and long terms", () => {
		expect(tokenizeQuery("𠮷野")).toEqual({ longTerms: [], shortTerms: ["𠮷野"], allShort: true });
		expect(tokenizeQuery("𠮷 𠮷野 𠮷野家 cloudflare")).toEqual({
			longTerms: ["𠮷野家", "cloudflare"],
			shortTerms: ["𠮷", "𠮷野"],
			allShort: false,
		});
	});
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
