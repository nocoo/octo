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
	expect(html).not.toMatch(/class="octo-(?:page|grid|actions|chart)/);
	expect(html).toContain("智能体活动");
	expect(html).toContain("空间");
	expect(html).not.toContain(">Space<");
	expect(html).not.toContain("Agent");
	expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[\s\S]*?查看活动数据表/);
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
				op: "update",
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
		["最近更新的记忆", ["28ch", "24ch", "24ch"]],
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
	expect(html).toMatch(/<td[^>]*class="[^"]*whitespace-normal break-words[^>]*>移入回收站<\/td>/);
	expect(html).toContain("知识工作台：检索与协作");
});
