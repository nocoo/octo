import { describe, expect, it } from "vitest";
import {
	buildFtsMatchQuery,
	escapeFtsToken,
	indexText,
	segmentText,
	supportsTrigram,
	tokenizeQuery,
} from "./tokenizer";

describe("shared word segmentation", () => {
	it.each([
		["他早上喝什么", ["早上", "喝"]],
		["密钥多久轮换一次", ["密钥", "轮换", "一次"]],
		["为什么选D1", ["选", "D1"]],
		["周会是什么时候", ["周会"]],
		["备份放在哪里", ["备份", "放在"]],
		["请问猫几岁了", ["猫", "岁"]],
		["what does he drink in the morning", ["drink", "morning"]],
		["how often are keys rotated", ["often", "keys", "rotated"]],
		["早上 喝 什么", ["早上", "喝"]],
		["the密钥 cf", ["密钥", "cf"]],
		["黑咖啡", ["黑", "咖啡"]],
		["部署 cloudflare worker", ["部署", "cloudflare", "worker"]],
	])("segments meaningful terms in %s", (query, expected) => {
		expect(tokenizeQuery(query as string)).toEqual(expected);
	});

	it.each(
		"什么 什么时候 多久 怎么 怎样 如何 为什么 为何 哪里 哪儿 在哪 哪个 哪些 几岁 几 多少 是不是 有没有 请问 他 她 它 你 您 我 我们 你们 他们 她们 它们 哪 吗 呢 吧 啊 的 了 着 是 有 没有 在 和 与 或 一下".split(
			" ",
		),
	)("removes curated question words: %s", (word) => {
		const result = tokenizeQuery(`咖啡 ${word}`);
		if (word === "几岁") expect(result).toEqual(["咖啡", "岁"]);
		else expect(result).toEqual(["咖啡"]);
	});

	it("keeps content compounds, case, and literal stopword-only queries", () => {
		expect(tokenizeQuery("在场证明 是非问题 有机咖啡 目的地")).toEqual([
			"在场",
			"证明",
			"是非",
			"问题",
			"有机",
			"咖啡",
			"目的地",
		]);
		expect(tokenizeQuery("WHAT Does HE drink IN THE morning")).toEqual(["drink", "morning"]);
		expect(tokenizeQuery("what is it")).toEqual(["what", "is", "it"]);
		expect(tokenizeQuery("请问什么呢")).toEqual(["请问", "什么", "呢"]);
		expect(tokenizeQuery("what 的")).toEqual(["what", "的"]);
	});

	it("indexes complete words plus Han unigrams without crossing punctuation", () => {
		const tokens = indexText("他早上只喝黑咖啡。密钥").split(" ");
		for (const token of ["早上", "喝", "咖啡", "密钥"]) expect(tokens).toContain(token);
		expect(tokens).not.toContain("啡密");
		expect(indexText("𠮷野").split(" ")).toEqual(expect.arrayContaining(["𠮷", "野", "𠮷野"]));
		expect(indexText("foo foo")).toBe("foo foo");
		expect(segmentText("ＡＰＩ_Ｄ１")).toEqual(["ＡＰＩ_Ｄ１"]);
		expect(tokenizeQuery("咖啡, 咖啡!")).toEqual(["咖啡"]);
		expect(indexText("🌟")).toBe("");
	});
});

describe("FTS query construction", () => {
	it("quotes independent tokens and prefers AND with explicit OR fallback", () => {
		expect(buildFtsMatchQuery(["cloudflare", "部署"])).toBe('"cloudflare" AND "部署"');
		expect(buildFtsMatchQuery(["cloudflare", "部署"], "OR")).toBe('"cloudflare" OR "部署"');
		expect(escapeFtsToken('a"b')).toBe('"a""b"');
		expect(buildFtsMatchQuery([])).toBeNull();
	});
	it.each(["e\u0301t", "ét", "部署", "𠮷野", "cf"])(
		"does not send short term %s to trigram",
		(term) => {
			expect(supportsTrigram(term)).toBe(false);
		},
	);
	it.each(["e\u0301ta", "étab", "𠮷野家", "e\u0345t", "cloudflare"])(
		"supports trigram term %s",
		(term) => {
			expect(supportsTrigram(term)).toBe(true);
		},
	);
});
