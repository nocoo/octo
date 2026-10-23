import type { CheckboxProps } from "@nocoo/basalt/components/checkbox";
import type { DataTableProps } from "@nocoo/basalt/components/data-table";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { TimelineGroup } from "../viewmodels/library-visualizations";
import { TimelineRecords } from "./library-timeline";

const controls = vi.hoisted(() => ({
	checkboxes: [] as CheckboxProps[],
	tables: [] as DataTableProps<TimelineGroup["items"][number]>[],
}));
vi.mock("@nocoo/basalt/components/checkbox", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/checkbox")>();
	return {
		...module,
		Checkbox: (props: CheckboxProps) => {
			controls.checkboxes.push(props);
			return <module.Checkbox {...props} />;
		},
	};
});
vi.mock("@nocoo/basalt/components/data-table", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/data-table")>();
	return {
		...module,
		DataTable: (props: DataTableProps<TimelineGroup["items"][number]>) => {
			controls.tables.push(props);
			return <module.DataTable {...props} />;
		},
	};
});

const group: TimelineGroup = {
	label: "2026-10-17",
	items: [
		{
			id: "m/1",
			title: "First note",
			space: "work",
			tags: [],
			version: 1,
			created_at: "2026-10-17T03:15:06Z",
			event_time: null,
			timestamp: Date.parse("2026-10-17T03:15:06Z"),
		},
	],
};
beforeEach(() => {
	controls.checkboxes = [];
	controls.tables = [];
});

it("uses spacing and color tokens present in the installed Basalt stylesheet", () => {
	const css = readFileSync(new URL("./library-timeline.css", import.meta.url), "utf8");
	const tokens = readFileSync(
		new URL(import.meta.resolve("@nocoo/basalt/styles/standalone")),
		"utf8",
	);
	for (const [, token] of css.matchAll(/var\((--basalt-[\w-]+)/g)) {
		expect(tokens).toContain(`${token}:`);
	}
});

it.each(["day", "hour", "month"] as const)(
	"renders one linked record per %s stream with exact UTC time",
	(zoom) => {
		const html = renderToStaticMarkup(
			<TimelineRecords
				groups={[group]}
				zoom={zoom}
				table={false}
				selected={["m/1"]}
				onSelected={() => {}}
			/>,
		);
		expect(html).not.toContain("<table");
		expect(html).toContain('aria-label="2026-10-17 的记忆"');
		expect(html).toContain('href="/memories/m%2F1"');
		expect(html).toContain('href="/memories?spaces=work"');
		expect(html).toContain('dateTime="2026-10-17T03:15:06.000Z"');
		expect(html).toContain("03:15:06 UTC");
		if (zoom === "month") expect(html).toContain("10-17 03:15:06 UTC");
		expect(html).toContain('aria-checked="true"');
		expect(html).not.toContain("data-tag-color");
	},
);

it("adds and removes a stream selection without dropping other dates", () => {
	const onSelected = vi.fn();
	renderToStaticMarkup(
		<TimelineRecords
			groups={[group]}
			zoom="day"
			table={false}
			selected={["other"]}
			onSelected={onSelected}
		/>,
	);
	controls.checkboxes[0]?.onCheckedChange?.(true);
	expect(onSelected).toHaveBeenLastCalledWith(["other", "m/1"]);
	controls.checkboxes[0]?.onCheckedChange?.(false);
	expect(onSelected).toHaveBeenLastCalledWith(["other"]);
});

it("keeps sortable paginated tables as an alternative and preserves selection in other groups", () => {
	const onSelected = vi.fn();
	const html = renderToStaticMarkup(
		<TimelineRecords
			groups={[group]}
			zoom="day"
			table
			selected={["other", "m/1"]}
			onSelected={onSelected}
		/>,
	);
	expect(html).not.toContain("<ol");
	expect(html).toContain('aria-label="2026-10-17 的时间线数据"');
	expect(controls.tables[0]?.pageSize).toBe(20);
	const item = group.items[0];
	if (!item) throw new Error("Missing fixture");
	expect(controls.tables[0]?.getRowId?.(item, 0)).toBe("m/1");
	for (const column of controls.tables[0]?.columns ?? [])
		expect(column.sortValue?.(item)).toBeDefined();
	controls.tables[0]?.onSelectedChange?.([]);
	expect(onSelected).toHaveBeenLastCalledWith(["other"]);
	controls.tables[0]?.onSelectedChange?.(["m/1"]);
	expect(onSelected).toHaveBeenLastCalledWith(["other", "m/1"]);
});

import { readFileSync } from "node:fs";
