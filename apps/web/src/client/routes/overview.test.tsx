import { ThemeProvider } from "@nocoo/basalt";
import { getChartColor } from "@nocoo/basalt/charts/config";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { activitySeries, OverviewModel } from "../viewmodels/overview";
import { activityChartSeries, OverviewPage } from "./overview";

const snapshot = vi.hoisted(() => ({ state: null as OverviewModel["state"] | null }));
vi.mock("../components/layout/use-model", () => ({
	useModel: (model: OverviewModel) => snapshot.state ?? model.state,
}));
afterEach(() => {
	snapshot.state = null;
});

it("distinguishes successful empty records from unknown data with package icons and actions", () => {
	const render = () =>
		renderToStaticMarkup(
			<ThemeProvider persist={false}>
				<MemoryRouter>
					<OverviewPage />
				</MemoryRouter>
			</ThemeProvider>,
		);
	const unknown = render();
	expect(unknown).not.toContain("还没有记忆");
	expect(unknown).not.toContain("暂无调用记录");
	snapshot.state = { ...new OverviewModel().state, memoryCount: 0 };
	const empty = render();
	expect(empty).toContain("还没有记忆");
	expect(empty).toMatch(/size-basalt-8[^>]*><svg/);
	expect(empty).toContain("浏览记忆");
});

it("uses an accessible Basalt disclosure for the chart table alternative", () => {
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter>
				<OverviewPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	expect(html).not.toContain("<details");
	expect(html).not.toContain("<summary");
	expect(html).toContain('class="grid gap-basalt-layout-lg"');
	expect(html).not.toMatch(/class="octo-(?:page|grid|actions|chart)(?:"|\s)/);
	expect(html).toContain("智能体活动");
	expect(html).toContain("空间");
	expect(html).not.toContain(">Space<");
	expect(html).not.toContain("Agent");
	expect(html).not.toContain("octo-title-icon");
	expect(html.match(/<h1\b/g)).toHaveLength(1);
	expect(html.match(/octo-stat-label/g)).toHaveLength(4);
	expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[\s\S]*?查看活动数据表/);
});

it("places every functional heading outside its card on the same-level surface", () => {
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter>
				<OverviewPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	for (const title of [
		"知识入口",
		"智能体活动 · 按密钥小时汇总",
		"调用趋势",
		"最近变更",
		"最近更新的记忆",
	]) {
		expect(html).toMatch(
			new RegExp(
				`<section[^>]*space-y-basalt-layout"[^>]*><div[^>]*><div[^>]*><h2[^>]*text-basalt-xl[^>]*>${title}</h2></div></div><div[^>]*data-basalt-surface=""`,
			),
		);
	}
	expect(html.slice(html.indexOf("<section")).match(/data-basalt-surface=""/g)).toHaveLength(5);
});

it("passes stable colors through the installed chart descriptor contract", () => {
	const one = activityChartSeries(activitySeries([{ day: "2026-10-17", key_id: "b", calls: 3 }]));
	const many = activityChartSeries(
		activitySeries([
			{ day: "2026-10-17", key_id: "a", calls: 1 },
			{ day: "2026-10-17", key_id: "b", calls: 3 },
		]),
	);
	expect(one[0]?.color).toBe(getChartColor(3));
	expect(many[1]?.color).toBe(one[0]?.color);
});

it("renders only real M7 metrics with rollup scope, change actors and unavailable health", () => {
	snapshot.state = {
		...new OverviewModel().state,
		memoryCount: 12,
		trashCount: 3,
		writesToday: 4,
		activeKeysToday: 1,
		usage: [
			{
				day: "2026-10-18",
				key_id: "k1",
				calls: 8,
				errors: 1,
				writes: 4,
				bytes_in: 20,
				bytes_out: 30,
			},
		],
		changes: [
			{
				seq: 2,
				entity: "memory",
				entity_id: "m1",
				op: "updated",
				actor: "admin:owner@example.com",
				at: "2026-10-18T01:00:00.000Z",
				version: 3,
				space_id: "s1",
			},
			{ seq: 1, entity: "memory", entity_id: "gone", op: "purged", at: "2026-10-18T00:00:00.000Z" },
		],
	};
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter>
				<OverviewPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	expect(html).toContain("今日写入次数 · UTC 小时汇总");
	expect(html).toContain("今日调用密钥 · UTC 小时汇总");
	expect(html).toContain("回收站记忆数");
	expect(html).toContain("当前接口未提供向量同步积压、D1 体积和定时任务最近运行时间");
	expect(html).not.toContain("待同步向量");
	expect(html).toContain("admin:owner@example.com");
	expect(html).toMatch(/dateTime="2026-10-18T01:00:00.000Z"/i);
	expect(html).toContain("未提供");
	expect(html).toContain('href="/memories/m1"');
	expect(html).not.toContain('href="/memories/gone"');
	expect(html).not.toContain("向量健康正常");
});

it.each([
	["created", "创建"],
	["updated", "更新"],
	["deleted", "删除"],
	["trashed", "移入回收站"],
	["purged", "永久删除"],
	["moved", "移动"],
	["restored", "恢复"],
	["rolled_back", "回滚"],
	["tag_renamed", "重命名标签"],
	["tag_merged", "合并标签"],
	["unexpected_operation", "其他操作"],
	["constructor", "其他操作"],
])("renders real change operation %s as Chinese copy", (operation, label) => {
	snapshot.state = {
		...new OverviewModel().state,
		changes: [
			{ seq: 1, entity: "memory", entity_id: "m1", op: operation, at: "2026-10-18T00:00:00Z" },
		],
	};
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter>
				<OverviewPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	expect(html).toContain(`>${label}</span></td>`);
	expect(html).not.toContain(`>${operation}</td>`);
});

it("gives overview records readable wrapping columns inside package scroll regions", () => {
	snapshot.state = {
		...new OverviewModel().state,
		changes: [
			{
				seq: 1,
				entity: "memory",
				entity_id: "01M55YM4GQAYQ0KVDC61GHRCJK",
				op: "trashed",
				actor: "admin:owner@example.com",
				at: "2026-10-18T01:00:00.000Z",
			},
		],
		recent: [
			{
				id: "m1",
				title: "知识工作台：检索与协作",
				space: "l3-b6f3628a23074d3d9304fad55d45f36b",
				tags: [],
				updated_at: "2026-10-18T01:00:00.000Z",
			},
		],
	};
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter>
				<OverviewPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	for (const [label, widths] of [
		["最近变更", ["28ch", "12ch", "28ch", "28ch"]],
		["最近更新的记忆", ["28ch", "24ch", "14ch"]],
	] as const) {
		expect(html).toContain(`aria-label="${label} scroll area" tabindex="0"`);
		const table = html.match(
			new RegExp(`<table\\b[^>]*aria-label="${label}"[\\s\\S]*?<\\/table>`),
		)?.[0];
		expect(table).toBeDefined();
		const heads = table?.match(/<th\b[^>]*>/g) ?? [];
		expect(heads).toHaveLength(widths.length);
		for (const [index, width] of widths.entries())
			expect(heads[index]).toContain(`style="width:${width};min-width:${width}"`);
		expect(table).not.toContain("aria-sort");
	}
	expect(html).toMatch(
		/<td[^>]*class="[^"]*whitespace-normal break-words[^>]*><span[^>]*data-tag-color="danger"[^>]*>移入回收站<\/span><\/td>/,
	);
	expect(html).toContain("知识工作台：检索与协作");
});

it("places compact knowledge shortcuts before charts and aligns overview tables", () => {
	snapshot.state = {
		...new OverviewModel().state,
		memoryCount: 1,
		usage: [],
		changes: [
			{ seq: 1, entity: "memory", entity_id: "m1", op: "updated", at: "2026-10-18T01:00:00Z" },
		],
		recent: [
			{ id: "m1", title: "记忆", space: "工作", tags: [], updated_at: "2026-10-18T01:00:00Z" },
		],
	};
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter>
				<OverviewPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	expect(html).not.toContain("self-start");
	expect(html.indexOf("知识入口")).toBeLessThan(html.indexOf("调用趋势"));
	expect([...html.matchAll(/管理密钥/g)]).toHaveLength(1);
	for (const label of ["最近变更", "最近更新的记忆"]) {
		const table = html.match(
			new RegExp(`<table\\b[^>]*aria-label="${label}"[\\s\\S]*?<\\/table>`),
		)?.[0];
		expect(table).toContain("ps-basalt-table-edge");
		expect(table).toContain("pe-basalt-table-edge");
	}
});
