import { readFileSync } from "node:fs";
import { ThemeProvider } from "@nocoo/basalt";
import { tagColorFor } from "@nocoo/basalt/components/tag-badge";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { SearchResult } from "../viewmodels/search";
import { SearchPage } from "./search";

const overrides = vi.hoisted(() => ({ state: {} as Record<string, unknown>, details: false }));
vi.mock("../components/layout/use-model", () => ({
	useModel: (model: { state: object }) => ({ ...model.state, ...overrides.state }),
}));
vi.mock("@nocoo/basalt/components/popover", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/popover")>();
	return {
		...module,
		Popover: ({ children }: import("@nocoo/basalt/components/popover").PopoverProps) => (
			<>{children}</>
		),
		PopoverTrigger: ({
			children,
		}: import("@nocoo/basalt/components/popover").PopoverTriggerProps) => <>{children}</>,
		PopoverContent: ({
			children,
		}: import("@nocoo/basalt/components/popover").PopoverContentProps) => (
			<div data-slot="popover-content">{children}</div>
		),
	};
});
vi.mock("@nocoo/basalt/components/collapsible", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/collapsible")>();
	return {
		...module,
		Collapsible: (props: Parameters<typeof module.Collapsible>[0]) => (
			<module.Collapsible {...props} defaultOpen={overrides.details} />
		),
	};
});
afterEach(() => {
	overrides.state = {};
	overrides.details = false;
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

it("exposes compact search controls in the header without losing URL form values", () => {
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter
				initialEntries={[
					"/search?q=worker&mode=vector&fusion=weighted&k=35&fts_weight=0&vector_weight=2&limit=20&spaces=notes",
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
	const heading =
		html.match(/octo-page-header"[\s\S]*?<\/header>/)?.[0] ??
		html.split("octo-page-actions")[1] ??
		"";
	expect(heading).toContain("data-search-input");
	expect(heading).toContain('aria-label="搜索模式"');
	expect(html).toContain('aria-label="常用记忆筛选"');
	expect(heading).toContain('aria-label="高级融合选项"');
	expect(heading).toContain('aria-controls="search-options"');
	expect(heading).not.toContain("结合全文与语义检索");
	expect(heading).toContain('form="search-options"');
	expect(html).toMatch(/<input[^>]*data-search-input/);
	expect(html).toMatch(/<button[^>]*aria-label="高级融合选项"[^>]*aria-expanded="true"/);
	expect(heading).toContain('aria-label="高级融合选项"');
	expect(html.match(/aria-label="记忆筛选"/g)).toHaveLength(1);
	expect(html).toContain('aria-label="记忆筛选"');
	expect(html).toMatch(/<form[^>]*id="search-options"[^>]*noValidate=""/i);
	const advanced = html.match(/<form\b[^>]*data-search-advanced="true"[^>]*>/)?.[0] ?? "";
	expect(advanced).toContain('id="search-options"');
	expect(advanced).not.toContain('hidden=""');
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

it("keeps default advanced values mounted and lets model errors reveal and focus hidden fields", () => {
	const html = renderResult();
	expect(html).toMatch(/<button[^>]*aria-label="高级融合选项"[^>]*aria-expanded="false"/);
	expect(html).toMatch(/<input[^>]*name="k"[^>]*value="60"/);
	expect(html).not.toMatch(/<input[^>]*name="k"[^>]*disabled/);
});

it("clears stale field errors on URL transitions without resetting them on draft or disclosure changes", () => {
	const source = readFileSync(new URL("search.tsx", import.meta.url), "utf8");
	expect(source).toMatch(
		/useLayoutEffect\(\(\) => \{\s*if \(previousQuery.current !== query\) \{\s*previousQuery.current = query;\s*setFieldErrors\(\{\}\);\s*\}\s*\}, \[query\]\)/,
	);
	expect(source).toContain("key={query}");
	expect(source).not.toContain("key={advancedOpen}");
	expect(source).not.toContain("key={fieldErrors}");
	expect(source).toMatch(/setFieldErrors\(\{\}\);\s*setParams\(new URLSearchParams\(\)\)/);
});

it("wraps result summary badges at intrinsic widths", () => {
	overrides.state = {
		result: { items: [], channels: { fts: { candidates: 0, partial: false }, vector: {} } },
	};
	const html = renderResult();
	const summary = html.match(/<div[^>]*role="status"[^>]*>/)?.[0] ?? "";
	expect(summary).toContain("display:flex");
	expect(summary).toContain("flex-wrap:wrap");
	expect(summary).not.toContain("8rem");
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
		"得分详情",
		"全文搜索结果不完整",
		"向量候选结果已截断",
		"配置或测试嵌入网关",
		"<mark>worker</mark>",
	])
		expect(html).toContain(text);
	expect(html).toMatch(/<table[^>]*class="[^"]*octo-table[^>]*aria-label="搜索结果"/);
	expect(html).toContain('data-basalt-data-table=""');
	expect(html).not.toContain("octo-title-icon");
	expect(html).not.toMatch(/<h2\b[^>]*>搜索结果<\/h2>/);
	expect(html).toContain('href="/memories/m1"');
	expect(html).toContain('href="/memories/m1/edit"');
	expect(html).toContain('aria-label="编辑 User title"');
	for (const label of ["work"])
		expect(html).toMatch(
			new RegExp(`<span[^>]*data-tag-color="${tagColorFor(label)}"[^>]*>${label}</span>`),
		);
	const headers = [...html.matchAll(/<th\b[^>]*>[\s\S]*?<\/th>/g)].map((match) => match[0]);
	for (const label of ["综合得分", "更新时间", "操作"])
		expect(headers.find((header) => header.includes(label))).toMatch(
			/<th[^>]*class="[^"]*text-end/,
		);
	expect(html).not.toContain('aria-sort="none"');
	expect(html).not.toContain('data-slot="card-header"');
	expect(html).not.toContain("Rank");
	overrides.details = true;
	const expanded = renderResult();
	for (const evidence of ["BM25", "-3.000", "余弦相似度", "0.8000", "第 1 名", "第 2 名"])
		expect(expanded).toContain(evidence);
	overrides.details = false;
	overrides.state = {
		result: {
			...result,
			items: [{ ...result.items[0], scores: { fused: 0, fts: null, vector: null } }],
		},
	};
	expect(renderResult()).toContain("得分详情");
	expect(renderResult()).not.toContain("全文：无匹配");
	expect(renderResult()).not.toContain("向量：无匹配");
	overrides.details = true;
	expect(renderResult()).toContain("全文：无匹配");
	expect(renderResult()).toContain("向量：无匹配");
});

it("keeps long space metadata out of the result title row", () => {
	const title = `知识工作台：${"unbroken".repeat(24)}`;
	const space = "l3-b6f3628a23074d3d9304fad55d45f36b";
	overrides.state = {
		result: {
			items: [
				{
					id: "m1",
					title,
					space,
					type: "note",
					tags: ["field-notes", "t".repeat(64)],
					updated_at: "2026-10-18T00:00:00Z",
					scores: { fused: 1, fts: null, vector: null },
				},
			],
			channels: { fts: { candidates: 1, partial: false }, vector: {} },
		} satisfies SearchResult,
	};
	const html = renderResult();
	const cells = [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
	expect(cells[0]).toContain(`<strong>${title}</strong>`);
	expect(cells[0]).not.toContain(space);
	expect(cells[0]).not.toContain("笔记");
	expect(cells[1]).toContain(space);
	expect(cells[1]).toContain("笔记");
	expect(cells[1]).toContain("field-notes");
	expect(cells[1]).toContain("flex-wrap:wrap");
	expect(cells[1]).toContain("overflow-wrap:anywhere");
	expect(cells[1]).toContain("t".repeat(64));
	const cellTags = [...html.matchAll(/<td\b[^>]*>/g)].map((match) => match[0]);
	for (const cell of cellTags.slice(0, 2)) expect(cell).toContain("whitespace-normal break-words");
	expect(html.match(/aria-label="搜索结果 scroll area"/g)).toHaveLength(1);
	expect(html).toMatch(/class="[^"]*relative[^">]*min-w-0 overflow-auto[^>]*>/);
	expect(html).toContain("min-width:40ch");
	expect(html).toContain("min-width:22ch");
});

it("preserves ranked results without local pagination and safely renders snippets and encoded links", () => {
	const items = Array.from({ length: 30 }, (_, index) => ({
		id: `memory/${index}`,
		title: `Result ${index}`,
		space: "notes",
		type: "note",
		tags: [],
		updated_at: "2026-10-17T00:00:00Z",
		snippet: "<script>alert(1)</script><mark>worker</mark>",
		scores: { fused: index === 0 ? 0.01 : 0.9, fts: null, vector: null },
	}));
	overrides.state = {
		result: { items, channels: { fts: { candidates: 30, partial: false }, vector: {} } },
	};
	const html = renderResult();
	expect(html.indexOf("Result 0")).toBeLessThan(html.indexOf("Result 1"));
	expect(html).toContain('href="/memories/memory%2F0"');
	expect(html).toContain('href="/memories/memory%2F0/edit"');
	expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;<mark>worker</mark>");
	expect(html).not.toContain("<script>");
	expect(html).not.toContain('aria-label="Pagination"');
	expect(html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr\b/g)).toHaveLength(30);
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
