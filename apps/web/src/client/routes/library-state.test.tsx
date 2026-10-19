import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryModel, type LibraryState } from "../viewmodels/library";
import { GraphPage, SpacesPage, TagsPage, TimelinePage } from "./library";

const snapshot = vi.hoisted(() => ({ state: null as LibraryState | null }));
vi.mock("../components/layout/use-model", () => ({
	useModel: (model: LibraryModel) => snapshot.state ?? model.state,
}));
vi.mock("./library-graph", () => ({ default: () => null }));

function render(Page: () => React.JSX.Element, url: string) {
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={[url]}>
				<Page />
			</MemoryRouter>
		</ThemeProvider>,
	);
}
const pages = [
	["/tags", TagsPage, "没有符合搜索条件的标签。"],
	["/spaces", SpacesPage, "还没有空间。"],
	["/graph", GraphPage, "暂无关系数据"],
	["/timeline", TimelinePage, "没有带有效时间的记忆"],
] as const;

afterEach(() => {
	snapshot.state = null;
});

it("bounds long space names without losing their accessible text", () => {
	const name = "字".repeat(256);
	snapshot.state = {
		...new LibraryModel("spaces").state,
		ready: true,
		spaces: [{ id: "s", slug: "work", name, description: "", owner_key_id: null, memory_count: 1 }],
	};
	const html = render(SpacesPage, "/spaces");
	const link = html.match(/<a\b[^>]*href="\/memories\?spaces=work"[^>]*>[\s\S]*?<\/a>/)?.[0];
	expect(link).toContain("block w-basalt-36 truncate");
	expect(link).toContain(`title="${name}"`);
	expect(link).toContain("data-tag-color=");
	expect(link?.replace(/<[^>]*>/g, "")).toBe(name);
	expect(html).toContain(`aria-label="重命名空间 ${name}"`);
});

it.each([
	[TagsPage, "/tags", "标签", ["24ch", "10ch", "24ch"]],
	[SpacesPage, "/spaces", "空间", ["24ch", "12ch", "36ch", "32ch", "24ch", "10ch"]],
	[GraphPage, "/graph", "图谱节点", ["24ch", "12ch", "10ch"]],
	[GraphPage, "/graph", "图谱关系", ["24ch", "24ch", "12ch"]],
	[TimelinePage, "/timeline", "2026-10-17 的时间线数据", ["28ch", "24ch", "24ch"]],
] as const)(
	"keeps %s record columns readable rather than squeezing them on mobile",
	(Page, url, label, widths) => {
		snapshot.state = {
			...new LibraryModel("graph").state,
			ready: true,
			memories: [
				{
					id: "m1",
					title: "知识工作台：检索与协作",
					space: "l3-b6f3628a23074d3d9304fad55d45f36b",
					tags: ["field-notes"],
					version: 1,
					created_at: "2026-10-17T00:00:00Z",
					event_time: "2026-10-17T00:00:00Z",
				},
			],
			tags: [{ id: "t", name: "field-notes", display_name: "工作台检索协作", use_count: 1 }],
			spaces: [
				{
					id: "s",
					slug: "l3-b6f3628a23074d3d9304fad55d45f36b",
					name: "知识工作台",
					description: "用于检索与协作的知识空间",
					owner_key_id: null,
					memory_count: 1,
				},
			],
		};
		const html = render(Page, url);
		expect(html).toContain(`aria-label="${label} scroll area" tabindex="0"`);
		const table = html.match(
			new RegExp(`<table\\b[^>]*aria-label="${label}"[\\s\\S]*?<\\/table>`),
		)?.[0];
		const heads = table?.match(/<th\b[^>]*style="[^"]*"[^>]*>/g) ?? [];
		expect(heads).toHaveLength(widths.length);
		for (const [index, width] of widths.entries())
			expect(heads[index]).toContain(`style="width:${width};min-width:${width}"`);
		if (Page !== TagsPage) expect(table).toContain("whitespace-normal break-words");
		if (Page === TagsPage || Page === SpacesPage) {
			expect(html).toContain("ps-basalt-table-edge");
			expect(html).toContain("pe-basalt-table-edge");
		}
		if (Page === TagsPage) expect(html).toContain('class="grid gap-basalt-layout-sm"');
	},
);

describe("library unknown, failed and empty states", () => {
	it.each(pages)(
		"does not claim an empty %s library before the initial request starts",
		(url, Page, empty) => {
			const html = render(Page, url);
			expect(html).toContain("正在加载资料库");
			expect(html).not.toContain(empty);
			expect(html).not.toContain("已加载 0 条记忆");
		},
	);
	it.each(pages)(
		"does not claim an empty %s library while initial loading is pending",
		(url, Page, empty) => {
			snapshot.state = { ...new LibraryModel("graph").state, busy: true };
			const html = render(Page, url);
			expect(html).toContain("正在加载资料库");
			expect(html).not.toContain(empty);
			expect(html).not.toContain("已加载 0 条记忆");
		},
	);
	it.each(pages)(
		"shows first-load failure and retry instead of false-empty %s data",
		(url, Page, empty) => {
			snapshot.state = { ...new LibraryModel("graph").state, error: "请求失败，请稍后重试。" };
			const html = render(Page, url);
			expect(html).toContain('role="alert"');
			expect(html).toContain("请求失败，请稍后重试。");
			expect(html).toContain("重试");
			expect(html).not.toContain("正在加载资料库");
			expect(html).not.toContain(empty);
			expect(html).not.toContain("已加载 0 条记忆");
		},
	);
	it.each(pages)(
		"shows legitimately empty %s data only after a successful read",
		(url, Page, empty) => {
			snapshot.state = { ...new LibraryModel("graph").state, ready: true };
			const html = render(Page, url);
			expect(html).toContain(empty);
			expect(html).toMatch(/size-basalt-8[^>]*><svg/);
			expect(html).toContain(Page === SpacesPage ? "创建空间" : "浏览记忆");
		},
	);
	it("keeps the spaces create action available while the initial read is pending", () => {
		snapshot.state = { ...new LibraryModel("spaces").state, busy: true };
		const html = render(SpacesPage, "/spaces");
		const createStart = html.lastIndexOf("<button", html.indexOf("lucide-folder-plus"));
		const createOpen = html.slice(createStart, html.indexOf(">", createStart) + 1);
		expect(createOpen).not.toContain('disabled=""');
	});
	it.each(pages)("keeps cached %s content visible when a refresh fails", (url, Page) => {
		snapshot.state = {
			...new LibraryModel("graph").state,
			ready: true,
			error: "请求失败，请稍后重试。",
			memories: [
				{
					id: "memory-1",
					title: "Cached memory",
					space: "work",
					tags: ["topic"],
					version: 1,
					created_at: "2026-10-17T00:00:00Z",
					event_time: "2026-10-17T00:00:00Z",
				},
			],
			tags: [{ id: "t", name: "topic", display_name: "Cached topic", use_count: 1 }],
			spaces: [
				{
					id: "s",
					slug: "work",
					name: "Cached space",
					description: "",
					owner_key_id: null,
					memory_count: 1,
				},
			],
		};
		const html = render(Page, url);
		expect(html).toContain("请求失败，请稍后重试。");
		expect(html).toContain("重试");
		expect(html).toContain("Cached");
		if (Page === GraphPage) {
			expect(html).toContain("2 个节点");
			expect(html).not.toContain("0 个节点");
		}
	});
	it("renders contemporary events with compact UTC timestamps in chronological order", () => {
		snapshot.state = {
			...new LibraryModel("timeline").state,
			ready: true,
			memories: [
				{
					id: "later",
					title: "稍后的资料",
					space: "work",
					tags: [],
					version: 1,
					created_at: "2026-10-18T03:45:00Z",
					event_time: "2026-10-18T03:45:00Z",
				},
				{
					id: "earlier",
					title: "较早的资料",
					space: "work",
					tags: [],
					version: 1,
					created_at: "2026-10-18T03:15:00Z",
					event_time: "2026-10-18T03:15:00Z",
				},
			],
		};
		const html = render(TimelinePage, "/timeline");
		const stream =
			html.match(/<ol[^>]*aria-label="2026-10-18 的记忆"[^>]*>[\s\S]*?<\/ol>/)?.[0] ?? "";
		expect(stream).toContain("较早的资料");
		expect(stream).toContain("稍后的资料");
		expect(stream).toContain("03:15 UTC");
		expect(stream).toContain("03:45 UTC");
		expect(stream.indexOf("较早的资料")).toBeLessThan(stream.indexOf("稍后的资料"));
		const table =
			html.match(/<table\b[^>]*aria-label="2026-10-18 的时间线数据"[\s\S]*?<\/table>/)?.[0] ?? "";
		expect(table).toContain("work");
		expect(table).toContain("稍后的资料");
		const monthlyHtml = render(TimelinePage, "/timeline?zoom=month");
		const monthlyStream =
			monthlyHtml.match(/<ol[^>]*aria-label="2026-10 的记忆"[^>]*>[\s\S]*?<\/ol>/)?.[0] ?? "";
		expect(monthlyStream).toContain("10-18 03:15 UTC");
		expect(monthlyStream).toContain("10-18 03:45 UTC");
	});
});
