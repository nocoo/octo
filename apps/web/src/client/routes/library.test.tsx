import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { GraphPage, SpacesPage, TagsPage, TimelinePage, TrashPage } from "./library";
import { LibraryBulkActions } from "./library-bulk";

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

describe("library page installed-component boundaries", () => {
	it.each([
		[TagsPage, "/tags", "标签"],
		[SpacesPage, "/spaces", "空间"],
		[TrashPage, "/trash", "回收站"],
		[GraphPage, "/graph", "关系图"],
		[TimelinePage, "/timeline", "时间线"],
	] as const)("renders %s using the actual Basalt package", (Page, url, title) => {
		const html = render(Page, url);
		expect(html).toContain(title);
		expect(html).toContain('class="grid gap-basalt-layout-lg"');
		expect(html).not.toMatch(/class="library-(?:page|stack|actions|fields|search)/);
		expect(html).toContain("正在加载资料库");
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
