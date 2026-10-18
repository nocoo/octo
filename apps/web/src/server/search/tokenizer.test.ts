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

	it("filters Chinese stopwords but preserves mixed-script and short English terms", () => {
		expect(tokenizeQuery("what 早上 喝 什么 the密钥 cf")).toEqual({
			longTerms: ["the密钥"],
			shortTerms: ["早上", "喝", "cf"],
			allShort: false,
		});
		expect(tokenizeQuery("密钥 多久 轮换")).toEqual({
			longTerms: [],
			shortTerms: ["密钥", "轮换"],
			allShort: true,
		});
	});

	it("keeps literal terms when every term is a Chinese or English stopword", () => {
		expect(tokenizeQuery("什么 多久")).toEqual({
			longTerms: [],
			shortTerms: ["什么", "多久"],
			allShort: true,
		});
		expect(tokenizeQuery("what 的")).toEqual({
			longTerms: ["what"],
			shortTerms: ["的"],
			allShort: false,
		});
	});

	it.each(
		`什么 多久 怎么 怎样 如何 为什么 为何 哪 哪里 哪个 哪些 吗 呢 吧 啊 的 了 着 是 有
没有 在 和 与 或 请问 一下 他 她 它 你 您 我 我们 你们 他们 她们 它们`.split(/\s+/),
	)("removes the whole Chinese function word %s", (word) => {
		expect(tokenizeQuery(`咖啡 ${word}`)).toEqual({
			longTerms: [],
			shortTerms: ["咖啡"],
			allShort: true,
		});
	});

	it.each(["黑咖啡", "每天早上喝黑咖啡", "在场证明", "是非问题", "有机咖啡", "了解情况", "目的地"])(
		"preserves the literal CJK phrase %s",
		(query) => {
			expect(tokenizeQuery(query)).toEqual({ longTerms: [query], shortTerms: [], allShort: false });
		},
	);

	it.each([
		{ query: "他早上喝什么", longTerms: ["早上喝"], shortTerms: [] },
		{ query: "密钥多久轮换一次", longTerms: ["轮换一次"], shortTerms: ["密钥"] },
		{ query: "咖啡怎么喝", longTerms: [], shortTerms: ["咖啡", "喝"] },
		{ query: "为什么喝黑咖啡", longTerms: ["喝黑咖啡"], shortTerms: [] },
		{ query: "请问密钥如何轮换", longTerms: [], shortTerms: ["密钥", "轮换"] },
		{ query: "黑咖啡吗", longTerms: ["黑咖啡"], shortTerms: [] },
	])(
		"filters unspaced questions without breaking remaining phrases: $query",
		({ query, longTerms, shortTerms }) => {
			expect(tokenizeQuery(query)).toEqual({
				longTerms,
				shortTerms,
				allShort: longTerms.length === 0,
			});
		},
	);

	it.each(["没有权限", "一次性密钥", "再怎么说", "咖啡的香气", "the什么", "密钥多久API"])(
		"does not rewrite negation, content compounds or mixed-script token %s",
		(query) => {
			expect(tokenizeQuery(query)).toEqual({ longTerms: [query], shortTerms: [], allShort: false });
		},
	);

	it("falls back to original tokens when unspaced questions contain only stopwords", () => {
		expect(tokenizeQuery("请问什么呢")).toEqual({
			longTerms: ["请问什么呢"],
			shortTerms: [],
			allShort: false,
		});
		expect(tokenizeQuery("what 请问什么呢")).toEqual({
			longTerms: ["what", "请问什么呢"],
			shortTerms: [],
			allShort: false,
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
