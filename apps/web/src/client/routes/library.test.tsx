import { ThemeProvider } from "@nocoo/basalt";
import { tagColorFor } from "@nocoo/basalt/components/tag-badge";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryState } from "../viewmodels/library";
import { GraphPage, SpacesPage, TagsPage, TimelinePage } from "./library";
import { LibraryBulkActions } from "./library-bulk";
import { GraphTables } from "./library-graph-tables";

vi.mock("./library-graph", () => ({ default: () => null }));
const overrides = vi.hoisted(() => ({ state: {} as Partial<LibraryState> }));
vi.mock("../components/layout/use-model", () => ({
	useModel: (model: { state: LibraryState }) => ({ ...model.state, ...overrides.state }),
}));
afterEach(() => {
	overrides.state = {};
});

function render(Page: () => React.JSX.Element, url: string) {
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={[url]}>
				<Page />
			</MemoryRouter>
		</ThemeProvider>,
	);
}

describe("library page installed-component boundaries", () => {
	it.each([
		[TagsPage, "/tags", "标签"],
		[SpacesPage, "/spaces", "空间"],
		[GraphPage, "/graph", "关系图"],
		[TimelinePage, "/timeline", "时间线"],
	] as const)("renders %s using the actual Basalt package", (Page, url, title) => {
		const html = render(Page, url);
		expect(html).toContain(title);
		expect(html).not.toContain("octo-title-icon");
		expect(html.match(/<h1\b/g)).toHaveLength(1);
		expect(html).toMatch(/<h2\b/);
		expect(html).toContain('class="grid gap-basalt-layout-lg"');
		expect(html).not.toMatch(/class="library-(?:page|stack|actions|fields|search)/);
		expect(html).toContain("正在加载资料库");
	});
	it("keeps one cooccurrence heading and moves its explore action before the card", () => {
		overrides.state = {
			ready: true,
			memories: [
				{
					id: "m1",
					title: "记忆",
					space: "notes",
					tags: ["work", "notes"],
					version: 1,
					created_at: "2026-10-17T00:00:00Z",
					event_time: null,
				},
			],
		};
		const html = render(TagsPage, "/tags");
		const section =
			html.match(
				/<section[^>]*><div[^>]*><div[^>]*><h2[^>]*>标签共现<\/h2>[\s\S]*?<\/section>/,
			)?.[0] ?? "";
		expect(section).toContain("text-basalt-xl");
		expect(section).toContain('href="/graph?mode=cooccurrence"');
		expect(section.indexOf("探索图谱")).toBeLessThan(section.indexOf('data-basalt-surface=""'));
		expect(section).toContain('aria-label="图谱关系"');
		expect(html).not.toContain("标签之间的联系");
	});
	it("moves graph counts and clustering information into the outer heading actions", () => {
		overrides.state = {
			ready: true,
			memories: Array.from({ length: 12 }, (_, index) => ({
				id: `m${index}`,
				title: `记忆 ${index}`,
				space: "notes",
				tags: ["work"],
				version: 1,
				created_at: "2026-10-17T00:00:00Z",
				event_time: null,
			})),
		};
		const html = render(GraphPage, "/graph?cap=10");
		const section =
			html.match(
				/<section[^>]*><div[^>]*><div[^>]*><h2[^>]*>知识关联<\/h2>[\s\S]*?<\/section>/,
			)?.[0] ?? "";
		expect(section).toContain("text-basalt-xl");
		expect(section).toContain("9 个节点 · 8 条关联");
		expect(section).toContain("已聚合 5 个节点");
		expect(section).not.toContain('data-basalt-surface=""');
		expect(html).not.toMatch(/<h3[^>]*>\d+ 个节点/);
	});
	it.each([
		["day", "2026-10-17"],
		["hour", "2026-10-17T03:00Z"],
		["month", "2026-10"],
	] as const)("places %s timeline group headings and counts outside their cards", (zoom, label) => {
		overrides.state = {
			ready: true,
			memories: [
				{
					id: "m1",
					title: "记忆",
					space: "notes",
					tags: [],
					version: 1,
					created_at: "2026-10-17T03:15:00Z",
					event_time: "2026-10-17T03:15:00Z",
				},
			],
		};
		const html = render(TimelinePage, `/timeline?zoom=${zoom}`);
		expect(html).toContain(`>${label}</h2>`);
		expect(html).toContain("1 条记忆 · UTC");
		expect(html.indexOf(`>${label}</h2>`)).toBeLessThan(html.indexOf('data-basalt-surface=""'));
		expect(html).toContain(`aria-label="${label} 的记忆"`);
		expect(html).not.toContain("<table");
	});
	it("uses stable native tag colors without losing canonical-name filtering or aligned actions", () => {
		overrides.state = {
			ready: true,
			tags: [{ id: "t1", name: "work", display_name: "工作", use_count: 12 }],
		};
		const html = render(TagsPage, "/tags?q=work");
		expect(html).toMatch(/<table[^>]*class="[^"]*octo-table/);
		expect(html).toMatch(
			new RegExp(`<span[^>]*data-tag-color="${tagColorFor("work")}"[^>]*>工作</span>`),
		);
		expect(html).toContain('href="/memories?tags_all=work"');
		expect(html).toContain('aria-label="重命名 工作"');
		expect(html).toContain('aria-label="合并 工作"');
		const headers = [...html.matchAll(/<th\b[^>]*>/g)].map((match) => match[0]);
		const cells = [...html.matchAll(/<td\b[^>]*>/g)].map((match) => match[0]);
		for (const index of [1, 2]) {
			expect(headers[index]).toContain("text-end");
			expect(cells[index]).toContain("text-end");
		}
		expect(html).toContain("justify-content:flex-end");
	});
	it("renders space names as plain navigation links with unchanged counts", () => {
		overrides.state = {
			ready: true,
			spaces: [
				{
					id: "s1",
					slug: "notes",
					name: "笔记",
					description: "",
					owner_key_id: null,
					memory_count: 12,
				},
			],
		};
		const html = render(SpacesPage, "/spaces?q=笔记");
		expect(html).toMatch(/<table[^>]*class="[^"]*octo-table/);
		expect(html).toMatch(/<a[^>]*href="\/memories\?spaces=notes"[^>]*>笔记<\/a>/);
		expect(html).not.toContain("data-tag-color=");
		expect(html).toContain('href="/memories?spaces=notes"');
		expect(html).toMatch(/<td[^>]*class="[^"]*text-end[^>]*><span[^>]*>12<\/span><\/td>/);
	});
	it("styles the graph data tables used by the graph sheet", () => {
		const graph = {
			nodes: [
				{
					id: "tag:work",
					label: "work",
					kind: "tag" as const,
					count: 1,
					href: "/memories?tags_all=work",
				},
				{
					id: "memory:m1",
					label: "记忆",
					kind: "memory" as const,
					count: 1,
					href: "/memories/m1",
				},
			],
			links: [{ source: "tag:work", target: "memory:m1", value: 1 }],
			clustered: 0,
		};
		const html = renderToStaticMarkup(
			<ThemeProvider persist={false}>
				<MemoryRouter>
					<GraphTables graph={graph} selected={[]} onSelected={() => {}} />
				</MemoryRouter>
			</ThemeProvider>,
		);
		for (const label of ["图谱节点", "图谱关系"]) expect(html).toContain(`aria-label="${label}"`);
		for (const table of html.matchAll(/<table\b[^>]*>/g)) expect(table[0]).toContain("octo-table");
		for (const [kind, color] of [
			["标签", "blue"],
			["记忆", "teal"],
		])
			expect(html).toMatch(new RegExp(`<span[^>]*data-tag-color="${color}"[^>]*>${kind}</span>`));
	});
	it("styles populated timeline tables", () => {
		overrides.state = {
			ready: true,
			memories: [
				{
					id: "m1",
					title: "记忆",
					space: "notes",
					tags: ["work"],
					version: 1,
					created_at: "2026-10-17T00:00:00Z",
					event_time: null,
				},
			],
		};
		const html = render(TimelinePage, "/timeline?field=created_at&view=table");
		expect(html).toContain("的时间线数据");
		for (const table of html.matchAll(/<table\b[^>]*>/g)) expect(table[0]).toContain("octo-table");
	});
	it("shows exact UTC timestamp range controls without implying inclusive whole dates", () => {
		const html = render(TimelinePage, "/timeline?from=2026-10-17T00%3A00%3A00Z&zoom=hour");
		expect(html).toContain("包含边界时刻的 UTC 时间");
		expect(html).toContain('value="2026-10-17T00:00:00Z"');
		expect(html).not.toContain('type="date"');
	});
	it("keeps timeline range filters compact until requested and exposes an accessible toggle", () => {
		const html = render(TimelinePage, "/timeline");
		expect(html).not.toContain('id="timeline-from"');
		expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[\s\S]*?筛选/);
	});
	it("uses package layout and Chinese copy for batch actions without changing user content", () => {
		const html = renderToStaticMarkup(
			<LibraryBulkActions memories={[]} selected={["memory-id"]} onComplete={() => {}} />,
		);
		expect(html).toContain("批量操作记忆");
		expect(html).toContain("已选择 1 条记忆");
		expect(html).toContain("添加标签");
		expect(html).toContain("移入回收站");
		expect(html).toContain("gap-basalt-layout");
		expect(html).not.toMatch(/class="library-(?:stack|actions)/);
	});
});
