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
