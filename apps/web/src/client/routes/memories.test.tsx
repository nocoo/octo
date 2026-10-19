import { readFileSync } from "node:fs";
import { ThemeProvider } from "@nocoo/basalt";
import { tagColorFor } from "@nocoo/basalt/components/tag-badge";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memory } from "../viewmodels/__tests__/memories-fixtures";
import { HistoryModel, MemoriesModel, MemoryModel } from "../viewmodels/memories";
import { EditorModel, toDraft } from "../viewmodels/memories-editor";
import { EditorPage, HistoryPage, MemoriesPage, MemoryPage } from "./memories";
import { Choice } from "./memories-filters";

const overrides = vi.hoisted(() => ({
	list: {} as Record<string, unknown>,
	editor: {} as Record<string, unknown>,
	history: {} as Record<string, unknown>,
}));
afterEach(() => {
	overrides.list = {};
	overrides.editor = {};
	overrides.history = {};
});

vi.mock("../components/layout/use-model", () => ({
	useModel: (model: { state: object }) => {
		if (model instanceof MemoriesModel)
			return { ...model.state, loaded: true, items: [memory], ...overrides.list };
		if (model instanceof MemoryModel) return { ...model.state, memory };
		if (model instanceof EditorModel)
			return { ...model.state, base: memory, draft: toDraft(memory), ...overrides.editor };
		if (model instanceof HistoryModel)
			return {
				...model.state,
				current: memory,
				versions: [{ ...memory, actor: "admin", op: "update" }],
				diff: {
					from: 1,
					to: 2,
					fields: [{ field: "title", from: "Before", to: "After" }],
					body: { hunks: [] },
				},
				...overrides.history,
			};
		return model.state;
	},
}));

function render(Page: () => React.JSX.Element, path: string) {
	const router = createMemoryRouter([{ path: "*", element: <Page /> }], { initialEntries: [path] });
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<RouterProvider router={router} />
		</ThemeProvider>,
	);
}

describe("memory pages use installed Basalt layouts and Chinese copy", () => {
	it("uses the shared compact table treatment, title icon and stable metadata colors", () => {
		overrides.list = { items: [{ ...memory, space: "notes", tags: ["work"] }] };
		const html = render(MemoriesPage, "/memories?selected=m1");
		expect(html).toMatch(/<table[^>]*class="[^"]*octo-table/);
		expect(html).toMatch(/<span class="octo-page-title"><svg[^>]*class="[^"]*octo-title-icon/);
		expect(html).toContain("lucide-book-open");
		for (const label of ["notes", "work"])
			expect(html).toMatch(
				new RegExp(`<span[^>]*data-tag-color="${tagColorFor(label)}"[^>]*>${label}</span>`),
			);
		expect(html).toMatch(/<th[^>]*class="[^"]*text-end[^>]*>更新时间<\/th>/);
		expect(html).toMatch(/<td[^>]*class="[^"]*text-end[^>]*><time/);
		expect(html).toContain('aria-selected="true"');
		expect(html).toContain('data-memory-link="m1"');
	});
	it("reveals one full-width filter form below the header for active URL filters", () => {
		const html = render(MemoriesPage, "/memories?spaces=notes&selected=m1&view=cards");
		const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
		expect(header).toContain("展开或收起记忆筛选");
		expect(header).toContain('aria-expanded="true"');
		expect(header).not.toContain('aria-label="记忆筛选"');
		expect(header).not.toContain("应用筛选");
		expect(html.match(/aria-label="记忆筛选"/g)).toHaveLength(1);
		expect(html.indexOf('aria-label="记忆筛选"')).toBeGreaterThan(html.indexOf("</header>"));
	});
	it("keeps the reader heading full-width and groups metadata with its single compact action toolbar", () => {
		const html = render(MemoryPage, "/memories/m1");
		const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
		expect(html.match(/<header\b/g)).toHaveLength(1);
		expect(header).not.toContain("版本历史");
		expect(header).not.toContain("编辑记忆");
		expect(html.indexOf("octo-memory-toolbar")).toBeGreaterThan(html.indexOf("</header>"));
		expect(html.match(/>本页目录<\/button>/g)).toHaveLength(1);
		const source = readFileSync(new URL("memories.tsx", import.meta.url), "utf8");
		expect(source).toContain("<SheetDescription>");
		expect(source).toMatch(/<Button[^>]*className="octo-memory-reader-compact"/);
	});
	it("top-aligns metadata/filter fields and associates one shared comma-separated-values hint", () => {
		const editor = render(EditorPage, "/memories/m1/edit");
		const metadata = editor.match(/<div[^>]*class="[^"]*octo-memory-metadata[^>]*>/)?.[0];
		expect(metadata).toContain("align-items:start");
		const filters = render(MemoriesPage, "/memories?spaces=notes");
		const form = filters.match(/<form\b[^>]*aria-label="记忆筛选"[\s\S]*?<\/form>/)?.[0] ?? "";
		expect(form).toContain("align-items:start");
		expect(form).not.toContain("align-items:end");
		expect(form.match(/多个值用英文逗号分隔/g)).toHaveLength(1);
		const hintId = form.match(/<p[^>]*id="([^"]+)"[^>]*>多个值用英文逗号分隔/)?.[1];
		expect(hintId).toBeTruthy();
		for (const name of ["spaces", "tags_all", "tags_any", "types", "sources"]) {
			const input = form.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
			expect(input).toContain(`aria-describedby="${hintId}"`);
		}
	});
	it("connects generated visible labels directly to unnamed Choice triggers", () => {
		const html = renderToStaticMarkup(<Choice label="类型" value="note" options={["note"]} />);
		const labelId = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
		expect(labelId).toBeTruthy();
		expect(html).toContain(`id="${labelId}"`);
		expect(html).toMatch(new RegExp(`<button[^>]*id="${labelId}"`));
	});
	it("announces persistent errors and uses intrinsic wrapping badges on attached tables", () => {
		overrides.list = { error: "offline" };
		const html = render(MemoriesPage, "/memories");
		expect(html).toMatch(/role="alert"[^>]*>[\s\S]*?offline/);
		expect(html).toContain("flex-wrap:wrap");
		expect(html).toContain("ps-basalt-table-edge");
		expect(html).toContain("pe-basalt-table-edge");
		expect(html).not.toContain('data-slot="card-well"');
	});
	it("gives the editor title a full track and aligns both document panel headings", () => {
		const html = render(EditorPage, "/memories/m1/edit");
		expect(html).toContain("octo-memory-metadata");
		expect(html).toContain("grid-column:1 / -1");
		expect(html.match(/data-slot="card-header"/g)).toHaveLength(2);
	});
	it("wraps ordinary history values without nested preformatted padding", () => {
		const long = "unbroken".repeat(120);
		overrides.history = {
			diff: {
				from: 1,
				to: 2,
				fields: [{ field: "title", from: long, to: "After" }],
				body: { hunks: [] },
			},
		};
		const html = render(HistoryPage, "/memories/m1/history");
		expect(html).toContain(`class="octo-memory-value">${long}</p>`);
		expect(html).not.toContain(`<pre>"${long}"</pre>`);
	});
	it("keeps rollback failure feedback separate from the irreversible-action description", () => {
		const source = readFileSync(new URL("memories.tsx", import.meta.url), "utf8");
		expect(source).not.toContain('<span role="alert">{state.error}</span>');
		expect(source).toMatch(
			/<AlertDialogDescription>[\s\S]*?<\/AlertDialogDescription>[\s\S]*?<Banner[\s\S]*?description=\{state.error\}/,
		);
	});
	it("composes reader responsiveness and overlay focus through public APIs", () => {
		const html = render(MemoryPage, "/memories/m1");
		expect(html).toContain("octo-memory-reader");
		expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>[\s\S]*?本页目录/);
		const css = readFileSync(new URL("../components/layout/markdown.css", import.meta.url), "utf8");
		expect(css).toContain("container-type: inline-size");
		expect(css).toContain("@container memory-reader (min-width: 60rem)");
		const source = readFileSync(new URL("memories.tsx", import.meta.url), "utf8");
		expect(source).toContain("onCloseAutoFocus=");
		expect(source).toMatch(
			/onNavigate=\{\(target\) => \{\s*tocTarget.current = target;\s*setTocOpen\(false\);/,
		);
		expect(source).toContain(
			"if (target && navigateToMarkdownHeading(target)) event.preventDefault()",
		);
		expect(source).toContain("toast.error(state.error");
	});
	it("preserves readable metadata beside long titles in the scrolling list", () => {
		overrides.list = {
			items: [
				{
					...memory,
					title: "Long title ".repeat(12),
					space: "s".repeat(64),
					tags: ["t".repeat(64)],
				},
			],
		};
		const html = render(MemoriesPage, "/memories");
		expect(html).toMatch(/<th[^>]*style="min-width:28ch"[^>]*>空间 \/ 标签<\/th>/);
		expect(html).toMatch(/<td[^>]*style="min-width:28ch"[^>]*><div[^>]*><span[^>]*>s{64}<\/span>/);
	});
	it.each(["/memories", "/memories?view=cards"])(
		"wraps unbroken space and tag values inside their badges at %s",
		(path) => {
			overrides.list = { items: [{ ...memory, space: "s".repeat(64), tags: ["t".repeat(64)] }] };
			const html = render(MemoriesPage, path);
			const gridStyle = html.match(/<div[^>]*style="([^"]*)"[^>]*><span[^>]*>s{64}<\/span>/)?.[1];
			expect(gridStyle).toContain("overflow-wrap:anywhere");
			expect(html).toContain("s".repeat(64));
			expect(html).toContain("t".repeat(64));
		},
	);
	it.each([
		[MemoriesPage, "/memories", ["记忆库", "标题", "空间 / 标签", "下一页"]],
		[MemoriesPage, "/memories?view=cards", ["记忆库", "卡片", "笔记"]],
		[MemoryPage, "/memories/m1", ["本页目录", "详细信息", "附件", "版本时间线"]],
		[EditorPage, "/memories/m1/edit", ["编辑记忆", "保存记忆", "实时预览", "选择文件"]],
		[HistoryPage, "/memories/m1/history", ["版本历史", "版本快照", "更新", "回滚", "正文差异"]],
	] as const)("renders %s without local layout wrappers", (Page, url, labels) => {
		const html = render(Page, url);
		for (const label of labels) expect(html).toContain(label);
		expect(html).toContain("grid gap-basalt-layout");
		expect(html).toContain("Title");
		expect(html).not.toMatch(/class="octo-page(?:\s|")/);
		expect(html).not.toContain("octo-actions");
	});
	it("shows an icon and primary action only for confirmed empty lists", () => {
		overrides.list = { items: [] };
		const empty = render(MemoriesPage, "/memories");
		expect(empty).toContain("lucide-search-x");
		expect(empty).toContain("刷新列表");
		overrides.list = { items: [], error: "请求失败", loaded: false };
		const failed = render(MemoriesPage, "/memories");
		expect(failed).toContain("lucide-circle-alert");
		expect(failed).toContain("重试");
		expect(failed).not.toContain("没有找到记忆");
		overrides.list = { items: [], loaded: false };
		expect(render(MemoriesPage, "/memories")).not.toContain("没有找到记忆");
	});
	it("keeps submitted option values while translating display labels", () => {
		const html = renderToStaticMarkup(
			<Choice label="类型" name="type" value="note" options={["note", "fact"]} />,
		);
		expect(html).toContain("笔记");
		expect(html).not.toContain(">note<");
		expect(html).toContain('name="type"');
		expect(readFileSync(new URL("memories-filters.tsx", import.meta.url), "utf8")).toContain(
			"<SelectItem value={option}",
		);
	});
	it("does not recreate native layout wrappers inside memory/search pages", () => {
		for (const name of ["memories.tsx", "memories-filters.tsx", "search.tsx"]) {
			const source = readFileSync(new URL(name, import.meta.url), "utf8");
			expect(source).not.toMatch(/<(?:div|section|article|header|footer|aside)\b/);
		}
	});
});
