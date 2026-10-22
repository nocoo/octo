import type {
	DataTableColumn,
	DataTableProps,
	DataTableSort,
} from "@nocoo/basalt/components/data-table";
import type { FilterBarProps, FilterChipProps } from "@nocoo/basalt/components/filter-bar";
import type { ComponentProps, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditModel, UsageDaily, UsageModel } from "../viewmodels/operations-observability";
import { AuditPage, UsagePage } from "./operations-observability";

type UsageRow = UsageDaily & { error_rate: number };
const fixture = vi.hoisted(() => ({
	usage: {} as Partial<UsageModel["state"]>,
	audit: {} as Partial<AuditModel["state"]> & { loaded?: boolean },
	sort: null as DataTableSort | null,
	columns: [] as DataTableColumn<UsageRow>[],
	search: "",
	setParams: vi.fn<(search: string) => void>(),
	chips: [] as FilterChipProps[],
	bar: null as FilterBarProps | null,
	form: null as ComponentProps<"form"> | null,
}));
vi.mock("react-router", async (original) => {
	const module = await original<typeof import("react-router")>();
	return {
		...module,
		useSearchParams: () => [new URLSearchParams(fixture.search), fixture.setParams],
	};
});
vi.mock("../components/layout/page-header", async (original) => {
	const module = await original<typeof import("../components/layout/page-header")>();
	return {
		...module,
		PageHeader: (props: ComponentProps<typeof module.PageHeader>) => {
			fixture.form = (props.filters as ReactElement<ComponentProps<"form">>).props;
			return <module.PageHeader {...props} />;
		},
	};
});
vi.mock("@nocoo/basalt/components/filter-bar", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/filter-bar")>();
	return {
		...module,
		FilterBar: (props: FilterBarProps) => {
			fixture.bar = props;
			return <module.FilterBar {...props} />;
		},
		FilterChip: (props: FilterChipProps) => {
			fixture.chips.push(props);
			return <module.FilterChip {...props} />;
		},
	};
});
vi.mock("../viewmodels/operations-observability", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-observability")>();
	return {
		...module,
		UsageModel: class extends module.UsageModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.usage };
			}
		},
		AuditModel: class extends module.AuditModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.audit };
			}
		},
	};
});
vi.mock("@nocoo/basalt/components/data-table", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/data-table")>();
	return {
		...module,
		DataTable: (props: DataTableProps<UsageRow>) => {
			fixture.columns = props.columns;
			return <module.DataTable {...props} defaultSort={fixture.sort} />;
		},
	};
});

function render(page: "usage" | "audit") {
	return renderToStaticMarkup(
		<MemoryRouter>{page === "usage" ? <UsagePage /> : <AuditPage />}</MemoryRouter>,
	);
}
const base: UsageDaily = {
	day: "2026-10-17",
	key_id: "key-ten",
	calls: 100,
	errors: 0,
	writes: 0,
	bytes_in: 0,
	bytes_out: 0,
};
const ids = (html: string) =>
	[...html.matchAll(/<td[^>]*><span[^>]*>(key-(?:ten|two|unknown))<\/span><\/td>/g)].map(
		(m) => m[1],
	);

beforeEach(() => {
	fixture.usage = {};
	fixture.audit = {};
	fixture.sort = null;
	fixture.columns = [];
	fixture.search = "";
	fixture.setParams.mockClear();
	fixture.chips = [];
	fixture.bar = null;
	fixture.form = null;
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("usage table sorting", () => {
	it("decorates the usage heading and keeps all numeric columns tabular and end-aligned", () => {
		fixture.usage = { loaded: true, items: [base] };
		const html = render("usage");
		expect(html).toMatch(/<table[^>]*class="[^"]*octo-table/);
		expect(html).not.toContain("octo-title-icon");
		const cells = [...html.matchAll(/<td\b[^>]*>/g)].map((match) => match[0]);
		for (const cell of cells.slice(2)) {
			expect(cell).toContain("text-end");
			expect(cell).toContain("tabular-nums");
		}
	});
	it("keeps readable minimum column widths inside the installed Basalt scroll region", () => {
		fixture.usage = { loaded: true, items: [base] };
		const html = render("usage");
		const widths = ["16ch", "18ch", "12ch", "12ch", "12ch", "12ch", "12ch", "12ch"];
		const headers = [...html.matchAll(/<th\b[^>]*>/g)].map((match) => match[0]);
		const cells = [...html.matchAll(/<td\b[^>]*>/g)].map((match) => match[0]);
		expect(headers).toHaveLength(widths.length);
		expect(cells).toHaveLength(widths.length);
		for (const [index, width] of widths.entries()) {
			expect(headers[index]).toContain(`style="width:${width};min-width:${width}"`);
			expect(cells[index]).toContain(`style="min-width:${width}"`);
			expect(cells[index]).toContain("whitespace-nowrap");
		}
		expect(html.match(/aria-label="每日用量表 scroll area"/g)).toHaveLength(1);
		expect(html).toContain("relative isolate min-w-0 overflow-auto");
	});

	it.each([
		["calls", "calls"],
		["errors", "errors"],
		["rate", "errors"],
		["writes", "writes"],
		["bytes_in", "bytes_in"],
		["bytes_out", "bytes_out"],
	] as const)("sorts %s numerically rather than as formatted text", (id, field) => {
		fixture.usage = {
			loaded: true,
			items: [
				{ ...base, [field]: 10 },
				{ ...base, key_id: "key-two", [field]: 2 },
			],
		};
		fixture.sort = { id, dir: "asc" };
		expect(ids(render("usage"))).toEqual(["key-two", "key-ten"]);
		fixture.sort = { id, dir: "desc" };
		expect(ids(render("usage"))).toEqual(["key-ten", "key-two"]);
	});

	it("uses a timestamp for day sorting and retains numeric latency with unavailable values last", () => {
		fixture.usage = {
			loaded: true,
			items: [
				{ ...base, day: "2026-12-01" },
				{ ...base, key_id: "key-two", day: "2026-02-01" },
				{ ...base, key_id: "key-unknown", day: "2027-01-01" },
			],
		};
		for (const id of ["day"]) {
			fixture.sort = { id, dir: "asc" };
			expect(ids(render("usage"))).toEqual(["key-two", "key-ten", "key-unknown"]);
		}
		expect(
			fixture.columns
				.find((column) => column.id === "day")
				?.sortValue?.({ ...base, error_rate: 0 }),
		).toBe(Date.parse(base.day));
	});
});

describe("observability read states", () => {
	it("uses the shared audit table, title icon and semantic status colors with numeric alignment", () => {
		fixture.audit = {
			loaded: true,
			items: [200, 403, 503].map((status) => ({
				id: `a${status}`,
				at: "2026-10-01T00:00:00Z",
				actor: "admin",
				method: "GET",
				route: "/api/v1/memories",
				status,
				error_code: null,
				request_id: "r",
				duration_ms: 2,
				bytes_in: null,
				bytes_out: null,
				ip_hash: null,
			})),
		};
		const html = render("audit");
		expect(html).toMatch(/<table[^>]*class="[^"]*octo-table/);
		expect(html).not.toContain("octo-title-icon");
		for (const [status, color] of [
			[200, "success"],
			[403, "warning"],
			[503, "danger"],
		])
			expect(html).toMatch(new RegExp(`<span[^>]*data-tag-color="${color}"[^>]*>${status}</span>`));
		const headers = [...html.matchAll(/<th\b[^>]*>/g)].map((match) => match[0]);
		const cells = [...html.matchAll(/<td\b[^>]*>/g)].map((match) => match[0]);
		expect(headers[3]).toContain("text-end");
		expect(cells[3]).toContain("text-end");
	});
	it.each([null, "无法加载审计日志。"])(
		"keeps an unknown audit query distinct from empty: %s",
		(error) => {
			fixture.audit = { loaded: false, error };
			const html = render("audit");
			expect(html).not.toContain("没有符合筛选条件的审计记录");
			expect(html).not.toContain("已加载全部查询结果");
			if (error) expect(html).toContain(error);
		},
	);

	it("shows successful audit emptiness and retains cached rows and pagination on refresh failure", () => {
		fixture.audit = { loaded: true };
		const empty = render("audit");
		expect(empty).toContain("没有符合筛选条件的审计记录");
		expect(empty).toContain("已加载全部查询结果");
		fixture.audit = {
			loaded: true,
			error: "无法加载审计日志。",
			nextCursor: "older",
			items: [
				{
					id: "a",
					at: "2026-10-01T00:00:00.000Z",
					actor: "cached-actor",
					method: "GET",
					route: "/api/v1/memories",
					status: 200,
					error_code: null,
					request_id: "r",
					duration_ms: 2,
					bytes_in: null,
					bytes_out: null,
					ip_hash: null,
				},
			],
		};
		const html = render("audit");
		expect(html).toContain("cached-actor");
		expect(html).toContain("无法加载审计日志。");
		expect(html).toContain("还有更多记录");
	});

	it.each([null, "无法加载每日用量。"])(
		"does not assert an empty unknown usage query: %s",
		(error) => {
			fixture.usage = { loaded: false, error };
			const html = render("usage");
			expect(html).not.toContain("此范围内暂无用量");
			expect(html).not.toContain("暂无每日用量记录。");
			if (error) expect(html).toContain(error);
		},
	);
});

it("renders only M7 daily writes and bytes, not fabricated infrastructure or percentiles", () => {
	fixture.usage = { loaded: true, items: [{ ...base, writes: 9, bytes_in: 123, bytes_out: 456 }] };
	const html = render("usage");
	for (const label of ["写入次数", "输入流量", "输出流量"]) expect(html).toContain(label);
	for (const fake of ["D1 占用", "待同步向量", "最近定时任务", "P50", "P95"])
		expect(html).not.toContain(fake);
	expect(html).toMatch(/<td[^>]*><span title="123 B">123 B<\/span><\/td>/);
	expect(html).toMatch(/<td[^>]*><span title="456 B">456 B<\/span><\/td>/);
});

describe("applied observability filters", () => {
	const audit = {
		actor: "key-live",
		action: "/api/v1/memories/:id",
		status: "403",
		from: "2026-10-01T08:30:00+08:00",
		to: "2026-10-17T18:45:00Z",
	};
	const usage = { key_id: "key-live", from: "2026-10-01", to: "2026-10-17" };

	it.each(["usage", "audit"] as const)("uses a labelled Basalt filter bar on %s", (page) => {
		const html = render(page);
		expect(fixture.bar?.label).toBe(page === "audit" ? "审计筛选" : "用量筛选");
		expect(fixture.chips).toEqual([]);
		for (const label of ["开始日期", "结束日期", page === "audit" ? "调用者" : "密钥标识"])
			expect(html).toContain(label);
	});

	it("places usage date controls before the key without changing table columns", () => {
		const html = render("usage");
		expect(html.indexOf('name="from"')).toBeLessThan(html.indexOf('name="to"'));
		expect(html.indexOf('name="to"')).toBeLessThan(html.indexOf('name="key_id"'));
		expect(fixture.columns.map((column) => column.id)).toEqual([
			"day",
			"key",
			"calls",
			"errors",
			"rate",
			"writes",
			"bytes_in",
			"bytes_out",
		]);
	});

	it.each(["usage", "audit"] as const)(
		"removes each applied %s condition independently without changing remaining times",
		(page) => {
			const applied = page === "audit" ? audit : usage;
			fixture.search = new URLSearchParams(applied).toString();
			render(page);
			const labels =
				page === "audit"
					? ["调用者", "路由模板", "状态码", "开始日期", "结束日期"]
					: ["密钥标识", "开始日期", "结束日期"];
			expect(fixture.chips).toHaveLength(Object.keys(applied).length);
			for (const [index, [key, value]] of Object.entries(applied).entries()) {
				const chip = fixture.chips.find((item) => item.label === labels[index]);
				expect(chip).toMatchObject({ value, removeLabel: `移除${labels[index]}筛选` });
				chip?.onRemove();
				const expected = new URLSearchParams(applied);
				expected.delete(key);
				expect(fixture.setParams).toHaveBeenLastCalledWith(expected.toString());
			}
		},
	);

	it.each(["usage", "audit"] as const)("keeps %s drafts inert until explicit submit", (page) => {
		const applied = page === "audit" ? audit : usage;
		fixture.search = new URLSearchParams(applied).toString();
		const html = render(page);
		const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
		expect(form).not.toMatch(/onchange|oninput/i);
		expect(fixture.setParams).not.toHaveBeenCalled();
		const data = new FormData();
		for (const [key, value] of Object.entries(applied))
			data.set(key, value.slice(0, key === "from" || key === "to" ? 10 : undefined));
		data.set(page === "audit" ? "actor" : "key_id", "  draft-key  ");
		vi.stubGlobal(
			"FormData",
			class {
				get(name: string) {
					return data.get(name);
				}
			},
		);
		fixture.form?.onSubmit?.({ preventDefault: vi.fn(), currentTarget: {} } as never);
		const submitted = new URLSearchParams(fixture.setParams.mock.lastCall?.[0]);
		expect(submitted.get(page === "audit" ? "actor" : "key_id")).toBe("draft-key");
		expect(submitted.get("from")).toBe("2026-10-01");
		expect(submitted.get("to")).toBe("2026-10-17");
		expect(fixture.chips.map((chip) => chip.value)).toEqual(
			expect.arrayContaining(Object.values(applied)),
		);
	});
});

it("keeps audit request and result details in six columns and virtual spacer spans", () => {
	fixture.audit = {
		loaded: true,
		items: Array.from({ length: 100 }, (_, index) => ({
			id: `audit-${index}`,
			at: "2026-10-01T00:00:00Z",
			actor: "key-live",
			method: "PATCH",
			route: "/api/v1/memories/:id",
			status: 403,
			error_code: "forbidden",
			request_id: `request-${index}`,
			duration_ms: 42,
			bytes_in: null,
			bytes_out: null,
			ip_hash: null,
		})),
	};
	const html = render("audit");
	const labels = [...html.matchAll(/<th\b[^>]*>([^<]+)<\/th>/g)].map((match) => match[1]);
	expect(labels).toEqual(["时间", "请求", "结果", "耗时", "调用者", "请求标识"]);
	const row = html.match(/<tr[^>]*data-audit-row=""[^>]*>[\s\S]*?<\/tr>/)?.[0] ?? "";
	const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
	expect(cells).toHaveLength(6);
	expect(cells[1]).toContain("PATCH");
	expect(cells[1]).toContain("/api/v1/memories/:id");
	expect(cells[2]).toContain("403");
	expect(cells[2]).toContain("没有执行此操作的权限。");
	expect(cells[3]).toContain("42");
	expect(cells[4]).toContain("key-live");
	expect(cells[5]).toContain("request-0");
	expect(html).toContain('aria-rowcount="101"');
	expect(html.match(/data-audit-row=""/g)?.length).toBeLessThan(100);
	expect(html).toMatch(/<td[^>]*class="[^"]*ops-spacer"[^>]*colSpan="6"/i);
	expect(render("audit")).toContain("导出 CSV");
	fixture.audit = { loaded: true };
	expect(render("audit")).toMatch(/<td[^>]*colSpan="6"/i);
});

it.each(["usage", "audit"] as const)(
	"groups date ranges and keeps filter actions together on %s",
	(page) => {
		const html = render(page);
		const form = html.slice(html.indexOf("<form"), html.indexOf("</form>") + "</form>".length);
		expect(form).toContain('role="group" aria-label="日期范围"');
		expect(form).toContain("ops-date-range");
		expect(form).toContain('role="group" aria-label="筛选操作"');
		expect(form).toContain("ops-filter-actions");
		const actions =
			form.match(/class="[^"]*ops-filter-actions[^"]*"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
		expect(actions).toContain("应用筛选");
		expect(actions).toContain("清除筛选");
	},
);
