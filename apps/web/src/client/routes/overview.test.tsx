import { ThemeProvider } from "@nocoo/basalt";
import { getChartColor } from "@nocoo/basalt/charts/config";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { activitySeries } from "../viewmodels/overview";
import { activityChartSeries, OverviewPage } from "./overview";

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
