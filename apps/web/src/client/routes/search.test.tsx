import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { SearchResult } from "../viewmodels/search";
import { SearchPage } from "./search";

const overrides = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("../components/layout/use-model", () => ({
	useModel: (model: { state: object }) => ({ ...model.state, ...overrides.state }),
}));
afterEach(() => {
	overrides.state = {};
});

function renderResult() {
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={["/search?q=worker"]}>
				<SearchPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
}

it("gives the query flexible width and keeps advanced fusion collapsed without losing form values", () => {
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter
				initialEntries={[
					"/search?q=worker&mode=vector&fusion=weighted&k=35&fts_weight=0&vector_weight=2&limit=20",
				]}
			>
				<SearchPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	expect(html).toContain("grid gap-basalt-layout");
	expect(html).not.toContain("octo-search-query-field");
	expect(html).toContain("搜索记忆");
	expect(html).toContain('aria-label="搜索选项"');
	const heading = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
	expect(heading).toContain("data-search-input");
	expect(heading).toContain("展开或收起记忆筛选");
	expect(heading).not.toContain("结合全文与语义检索");
	expect(heading).toContain('form="search-options"');
	expect(html).toMatch(/<input[^>]*data-search-input/);
	expect(html).toMatch(/<button[^>]*aria-label="高级融合选项"[^>]*aria-expanded="false"/);
	const advanced = html.match(/<div\b[^>]*data-search-advanced="true"[^>]*>/)?.[0] ?? "";
	expect(advanced).toContain('data-state="closed"');
	expect(advanced).toContain('hidden=""');
	for (const name of ["mode", "fusion", "k", "fts_weight", "vector_weight", "limit"])
		expect(html).toContain(`name="${name}"`);
	for (const [name, value] of [
		["k", "35"],
		["fts_weight", "0"],
		["vector_weight", "2"],
		["limit", "20"],
	])
		expect(html).toMatch(new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"`));
});

it("localizes channel evidence and leaves user content unchanged", () => {
	const result: SearchResult = {
		items: [
			{
				id: "m1",
				title: "User title",
				space: "notes",
				type: "note",
				tags: ["work"],
				updated_at: "2026-10-17T00:00:00Z",
				snippet: "A <mark>worker</mark>",
				scores: {
					fused: 0.03,
					fts: { rank: 1, bm25: -3, normalized: 0.7 },
					vector: { rank: 2, similarity: 0.8, normalized: 0.8 },
				},
			},
		],
		channels: { fts: { candidates: 2, partial: true }, vector: { candidates: 3, truncated: true } },
	};
	overrides.state = { result, fallback: true };
	const html = renderResult();
	for (const text of [
		"User title",
		"笔记",
		"全文候选",
		"向量候选",
		"综合得分",
		"第 1 名",
		"余弦相似度",
		"全文搜索结果不完整",
		"向量候选结果已截断",
		"配置或测试嵌入网关",
		"<mark>worker</mark>",
	])
		expect(html).toContain(text);
	expect(html).not.toContain("Rank");
	overrides.state = {
		result: {
			...result,
			items: [{ ...result.items[0], scores: { fused: 0, fts: null, vector: null } }],
		},
	};
	expect(renderResult()).toContain("全文：无匹配");
	expect(renderResult()).toContain("向量：无匹配");
});

it("distinguishes successful zero matches from unavailable results", () => {
	overrides.state = {
		result: { items: [], channels: { fts: { candidates: 0, partial: false }, vector: {} } },
	};
	const empty = renderResult();
	expect(empty).toContain("没有匹配结果");
	expect(empty).toContain("lucide-search");
	expect(empty).toContain("重新搜索");
	overrides.state = { ...overrides.state, error: "请求失败，请稍后重试。" };
	const failed = renderResult();
	expect(failed).toContain("lucide-circle-alert");
	expect(failed).toContain("重试");
	expect(failed).not.toContain("没有匹配结果");
});

it("offers an icon and primary action before the first search", () => {
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter>
				<SearchPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	expect(html).toContain("lucide-search");
	expect(html).toContain("输入关键词");
	expect(html).toContain("开始搜索");
});
