import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardPayload } from "../viewmodels/overview";
import { OverviewPage } from "./overview";

const snapshot = vi.hoisted(() => ({
	state: { loading: false, error: null, data: null } as unknown as OverviewPayloadState,
}));
vi.mock("../components/layout/use-model", () => ({
	useModel: () => snapshot.state,
}));

type OverviewPayloadState = {
	loading: boolean;
	error: string | null;
	data: DashboardPayload | null;
};

const data: DashboardPayload = {
	range: { from: "2026-10-16", to: "2026-10-18", days: 3 },
	totals: { memories: 5, trash: 2, spaces: 2, keys: 2 },
	ops: [
		{ day: "2026-10-16", actor: "key:K1", space_id: "s1", op: "created", count: 2 },
		{ day: "2026-10-17", actor: "key:K2", space_id: "s2", op: "updated", count: 3 },
		{ day: "2026-10-18", actor: "key:K1", space_id: "s2", op: "trashed", count: 1 },
	],
	usage: [
		{ day: "2026-10-16", key_id: "K1", calls: 10, errors: 1, writes: 4 },
		{ day: "2026-10-17", key_id: "K2", calls: 40, errors: 0, writes: 2 },
	],
	types: [
		{ space_id: "s1", type: "fact", count: 3 },
		{ space_id: "s2", type: "note", count: 2 },
	],
	spaces: [
		{ id: "s1", slug: "kb", name: "知识库", memories: 3, trash: 1 },
		{ id: "s2", slug: "notes", name: "笔记", memories: 2, trash: 1 },
	],
	keys: [
		{ id: "K1", name: "采集助手", role: "project", revoked: false, last_used_at: null },
		{ id: "K2", name: "整理助手", role: "drop", revoked: true, last_used_at: null },
	],
};

const idle = (payload: DashboardPayload): OverviewPayloadState => ({
	loading: false,
	error: null,
	data: payload,
});

const unknown = (): OverviewPayloadState => ({ loading: false, error: null, data: null });
afterEach(() => {
	snapshot.state = unknown();
});

function render(path = "/") {
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={[path]}>
				<OverviewPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
}

it("distinguishes a successful empty dataset from unknown data", () => {
	const pending = render();
	expect(pending).toContain("正在汇总总览");
	expect(pending).not.toContain("还没有活动数据");
	snapshot.state = idle({
		...data,
		totals: { ...data.totals, memories: 0, trash: 0 },
		ops: [],
		usage: [],
		types: [],
		spaces: [],
	});
	const empty = render();
	expect(empty).toContain("还没有活动数据");
	expect(empty).not.toMatch(/<table/);
});

it("keeps one page heading, the range switch and no feature entry points", () => {
	snapshot.state = idle(data);
	const html = render("/?range=90");
	expect(html.match(/<h1\b/g)).toHaveLength(1);
	expect(html).toContain("近 90 天");
	expect(html.match(/aria-pressed|data-state="on"/g)?.length).toBeGreaterThan(0);
	for (const entry of [
		"浏览记忆",
		"混合搜索",
		"探索关系",
		"查看活动数据表",
		"最近变更",
		"最近更新的记忆",
	])
		expect(html).not.toContain(entry);
	expect(html).not.toMatch(/<table/);
	expect(html.match(/class="basalt-stat-strip|octo-stat-label/g)).toBeTruthy();
});

it("renders every section title outside its card in Basalt section chrome", () => {
	snapshot.state = idle(data);
	const html = render();
	for (const title of ["操作趋势", "Bot 活动", "分布", "排行"])
		expect(html).toMatch(
			new RegExp(
				`<section class="basalt-ui[^"]*"><div[^>]*><div[^>]*><h2[^>]*>${title}</h2>[\\s\\S]*?</section>`,
			),
		);
	expect(html).toContain("记忆类型");
	expect(html).toContain("空间分布");
	expect(html).toContain("操作构成");
});

it("lists memory types and shares in the donut legend", () => {
	snapshot.state = idle(data);
	const html = render();
	expect(html).toContain("事实");
	expect(html).toContain("笔记");
	expect(html).toContain("60%");
	expect(html).toContain("40%");
});

it("lists clickable bot and space rows with activity metadata", () => {
	snapshot.state = idle(data);
	const html = render();
	expect(html).toContain('aria-label="查看 采集助手 详情"');
	expect(html).toContain('aria-label="查看 笔记 详情"');
	expect(html).toContain("错误率");
});
