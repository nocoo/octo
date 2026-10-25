import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import type { LibraryGraph } from "../viewmodels/library-visualizations";
import LibraryGraphCanvas from "./library-graph";

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

function render(graph: LibraryGraph, url = "/graph") {
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={[url]}>
				<LibraryGraphCanvas graph={graph} />
			</MemoryRouter>
		</ThemeProvider>,
	);
}

const graph: LibraryGraph = {
	nodes: [
		{
			id: "tag:planning",
			label: "planning",
			kind: "tag",
			count: 2,
			href: "/memories?tags_all=planning",
		},
		{
			id: "tag:reading",
			label: "reading",
			kind: "tag",
			count: 1,
			href: "/memories?tags_all=reading",
		},
		{
			id: "memory:m1",
			label: "Borrowed essay collection",
			kind: "memory",
			count: 1,
			href: "/memories/m1",
			space: "notes",
			tags: ["planning", "reading"],
			time: "2026-10-17T03:15:06Z",
		},
		{ id: "cluster:tag", label: "4 个标签节点", kind: "cluster", count: 4, href: null },
	],
	links: [
		{ source: "tag:planning", target: "memory:m1", value: 1 },
		{ source: "tag:reading", target: "memory:m1", value: 2 },
	],
	clustered: 4,
};

it("hosts the canvas in a full-height Basalt surface with an accessible summary", () => {
	const html = render(graph);
	expect(html).toContain("octo-graph-stage");
	expect(html).toContain('role="img"');
	expect(html).toContain("力导向关系图，4 个节点、2 条关联");
	expect(html).toContain('data-basalt-surface=""');
	expect(html).not.toContain('class="library-');
});

it("exposes every canvas action as a labelled toolbar button", () => {
	const html = render(graph);
	expect(html).toContain('aria-label="关系图工具"');
	for (const label of [
		"放大",
		"缩小",
		"适应画布",
		"显示节点名称",
		"暂停布局计算",
		"节点列表",
		"图谱数据表",
	])
		expect(html).toContain(`aria-label="${label}"`);
	expect(html).toMatch(/aria-label="显示节点名称"[^>]*aria-pressed="true"/);
	expect(html).toMatch(/aria-label="暂停布局计算"[^>]*aria-pressed="false"/);
});

it("lists rankable nodes with their degree instead of raw names alone", () => {
	const html = render(graph);
	expect(html).toContain('aria-label="搜索节点"');
	expect(html).toContain('aria-label="节点列表"');
	for (const label of ["全部", "标签", "记忆"]) expect(html).toContain(`>${label}<`);
	expect(html).toContain('aria-pressed="false"');
	expect(html).toContain("Borrowed essay collection");
	expect(html).toContain('class="octo-graph-row-count">2</span>');
	expect(html).toContain('class="octo-graph-row-count">1</span>');
});

it("reports the legend and clustering state without a second heading", () => {
	const html = render(graph);
	for (const label of ["标签", "记忆", "聚合节点"]) expect(html).toContain(label);
	expect(html).toContain("已聚合 4 个节点。拖动平移，滚轮缩放，点击节点查看关联。");
	expect(html).not.toMatch(/<h3/);
});

it("opens the inspector for a memory node with its metadata and navigation", () => {
	const html = render(graph, "/graph?node=memory%3Am1");
	expect(html).toContain("关闭节点详情");
	expect(html).toContain("Borrowed essay collection");
	expect(html).toContain('href="/memories/m1"');
	expect(html).toContain("打开记忆");
	expect(html).toContain('href="/memories?spaces=notes"');
	expect(html).toContain("关联节点 · 2");
});

it("adapts the inspector action to tags and clusters", () => {
	const tag = render(graph, "/graph?node=tag%3Aplanning");
	expect(tag).toContain("查看该标签的记忆");
	expect(tag).toContain('href="/memories?tags_all=planning"');
	expect(tag).toContain("记忆数");
	const cluster = render(graph, "/graph?node=cluster%3Atag");
	expect(cluster).toContain("聚合节点。提高节点上限或缩小筛选范围后可以打开单个节点。");
	expect(cluster).not.toContain("打开记忆");
});

it("keeps the node filter in the URL rather than in local state", () => {
	const html = render(graph, "/graph?find=reading&kind=tag");
	expect(html).toContain('value="reading"');
	expect(html).not.toContain("Borrowed essay collection");
	expect(html).toMatch(/aria-checked="true"[^>]*>标签</);
	expect(html).toContain('class="octo-graph-row-count">1</span>');
});

it("does not render node tables until the data sheet is opened", () => {
	const html = render(graph);
	expect(html).not.toContain("<table");
	expect(html).toContain("图谱数据表");
});
