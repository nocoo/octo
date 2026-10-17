import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryModel, type LibraryState } from "../viewmodels/library";
import { GraphPage, SpacesPage, TagsPage, TimelinePage, TrashPage } from "./library";

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
	["/trash", TrashPage, "当前筛选条件下，回收站为空。"],
	["/graph", GraphPage, "暂无关系数据"],
	["/timeline", TimelinePage, "没有带有效时间的记忆"],
] as const;

afterEach(() => {
	snapshot.state = null;
});

it.each([
	[TagsPage, "/tags", "标签", ["24ch", "10ch", "28ch"]],
	[SpacesPage, "/spaces", "空间", ["24ch", "36ch", "32ch", "24ch", "10ch"]],
	[TrashPage, "/trash", "回收站中的记忆", ["24ch", "24ch", "24ch", "16ch"]],
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
});
