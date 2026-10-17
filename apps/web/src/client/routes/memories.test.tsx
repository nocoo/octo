import { readFileSync } from "node:fs";
import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memory } from "../viewmodels/__tests__/memories-fixtures";
import { HistoryModel, MemoriesModel, MemoryModel } from "../viewmodels/memories";
import { EditorModel, toDraft } from "../viewmodels/memories-editor";
import { EditorPage, HistoryPage, MemoriesPage, MemoryPage } from "./memories";
import { Choice } from "./memories-filters";

const overrides = vi.hoisted(() => ({ list: {} as Record<string, unknown> }));
afterEach(() => {
	overrides.list = {};
});

vi.mock("../components/layout/use-model", () => ({
	useModel: (model: { state: object }) => {
		if (model instanceof MemoriesModel)
			return { ...model.state, loaded: true, items: [memory], ...overrides.list };
		if (model instanceof MemoryModel) return { ...model.state, memory };
		if (model instanceof EditorModel)
			return { ...model.state, base: memory, draft: toDraft(memory) };
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
		expect(html).not.toContain("octo-page");
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
