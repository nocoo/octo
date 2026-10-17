import { describe, expect, it } from "vitest";
import { client } from "./__tests__/memories-fixtures";
import { SearchModel, scoreBars, searchFromUrl, snippetParts } from "./search";

describe("search URL contract", () => {
	it("builds hybrid, vector and weighted requests including all filters", () => {
		expect(searchFromUrl(new URLSearchParams("q=worker"))).toEqual({
			query: "worker",
			mode: "hybrid",
			fusion: { method: "rrf", k: 60, weights: { fts: 1, vector: 1 } },
			filters: {},
			limit: 50,
			include: ["snippet"],
		});
		expect(
			searchFromUrl(
				new URLSearchParams(
					"q=hi&mode=vector&fusion=weighted&k=40&fts_weight=0&vector_weight=2&limit=10&spaces=notes&tags_all=one&time_field=event&importance_min=0",
				),
			),
		).toEqual({
			query: "hi",
			mode: "vector",
			fusion: { method: "weighted", k: 40, weights: { fts: 0, vector: 2 } },
			filters: {
				spaces: ["notes"],
				tags_all: ["one"],
				time: { field: "event" },
				importance: { min: 0 },
			},
			limit: 10,
			include: ["snippet"],
		});
	});
	it("rejects missing query and invalid mode/fusion/weights/limits rather than silently changing semantics", () => {
		for (const query of [
			"",
			"q=%20",
			"q=x&mode=bad",
			"q=x&fusion=bad",
			"q=x&k=0",
			"q=x&k=201",
			"q=x&fts_weight=-1",
			"q=x&vector_weight=NaN",
			"q=x&fts_weight=0&vector_weight=0",
			"q=x&limit=0",
		])
			expect(() => searchFromUrl(new URLSearchParams(query))).toThrow();
		expect(searchFromUrl(new URLSearchParams("q=x&mode=fts")).mode).toBe("fts");
	});
});

describe("score bars and safe snippets", () => {
	it("preserves raw channel evidence while scaling bars separately", () => {
		expect(
			scoreBars(
				{
					fused: 0.03,
					fts: { rank: 1, bm25: -5, normalized: 0.7 },
					vector: { rank: 2, similarity: 0.8, normalized: 0.5 },
				},
				0.06,
			),
		).toEqual({ fused: 50, fts: 70, vector: 50 });
		expect(scoreBars({ fused: 0, fts: null, vector: null }, 0)).toEqual({
			fused: 0,
			fts: null,
			vector: null,
		});
		expect(
			scoreBars(
				{
					fused: 4,
					fts: { rank: 1, bm25: 0, normalized: -1 },
					vector: { rank: 2, similarity: 0, normalized: 2 },
				},
				2,
			),
		).toEqual({ fused: 100, fts: 0, vector: 100 });
	});
	it("only recognizes mark tags, decodes escaped text and never emits HTML", () => {
		expect(
			snippetParts("a &amp; <mark>worker &lt;x&gt;</mark> <img src=x> &quot;q&quot; &#39;s&#39;"),
		).toEqual([
			{ text: "a & ", marked: false, offset: 0 },
			{ text: "worker <x>", marked: true, offset: 4 },
			{ text: " <img src=x> \"q\" 's'", marked: false, offset: 14 },
		]);
		expect(snippetParts("plain")).toEqual([{ text: "plain", marked: false, offset: 0 }]);
		expect(snippetParts("")).toEqual([]);
		expect(snippetParts("<mark>x")).toEqual([{ text: "x", marked: true, offset: 0 }]);
	});
});

describe("SearchModel", () => {
	it("exposes real channel fallback, partial and truncated evidence, and caches successful searches", async () => {
		const { request, api } = client();
		const model = new SearchModel(api);
		const response = {
			items: [],
			channels: {
				fts: { candidates: 4, partial: true },
				vector: { skipped: "embedder_unavailable", candidates: 0, truncated: true, profile: null },
			},
		};
		request.mockResolvedValueOnce(response);
		await model.load(new URLSearchParams("q=worker"));
		expect(model.state.result).toEqual(response);
		expect(model.state.fallback).toBe(true);
		expect(request).toHaveBeenCalledWith("/search", {
			method: "POST",
			json: searchFromUrl(new URLSearchParams("q=worker")),
		});
		request.mockImplementationOnce(async () => {
			expect(model.state.result).toEqual(response);
			throw new Error("offline");
		});
		await model.load(new URLSearchParams("q=worker"));
		expect(model.state.error).toBe("请求失败，请稍后重试。");
		request.mockResolvedValueOnce({
			items: [],
			channels: {
				fts: { candidates: 0, partial: false },
				vector: { candidates: 0, truncated: false, profile: "p" },
			},
		});
		await model.load(new URLSearchParams("q=other"));
		expect(model.state.fallback).toBe(false);
	});
	it("is idle for no query, validates bad URLs, ignores stale responses and stale failures", async () => {
		const { request, api } = client();
		const model = new SearchModel(api);
		await model.load(new URLSearchParams());
		expect(request).not.toHaveBeenCalled();
		await model.load(new URLSearchParams("q=x&mode=bad"));
		expect(model.state.error).toBeTruthy();
		let resolve!: (value: unknown) => void;
		let reject!: (error: unknown) => void;
		request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const stale = model.load(new URLSearchParams("q=old"));
		await model.load(new URLSearchParams());
		resolve({ items: [], channels: { vector: { skipped: "embedder_unavailable" } } });
		await stale;
		expect(model.state.result).toBeNull();
		request.mockImplementationOnce(
			() =>
				new Promise((_done, fail) => {
					reject = fail;
				}),
		);
		const failed = model.load(new URLSearchParams("q=old"));
		await model.load(new URLSearchParams());
		reject("old");
		await failed;
		expect(model.state.error).toBeNull();
	});
});
