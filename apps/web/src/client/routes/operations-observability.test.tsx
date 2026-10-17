import type {
	DataTableColumn,
	DataTableProps,
	DataTableSort,
} from "@nocoo/basalt/components/data-table";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditModel, UsageDaily, UsageModel } from "../viewmodels/operations-observability";
import { AuditPage, UsagePage } from "./operations-observability";

type UsageRow = UsageDaily & { error_rate: number };
const fixture = vi.hoisted(() => ({
	usage: {} as Partial<UsageModel["state"]>,
	audit: {} as Partial<AuditModel["state"]> & { loaded?: boolean },
	sort: null as DataTableSort | null,
	columns: [] as DataTableColumn<UsageRow>[],
}));
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
	[...html.matchAll(/<td[^>]*>(key-(?:ten|two|unknown))<\/td>/g)].map((m) => m[1]);

beforeEach(() => {
	fixture.usage = {};
	fixture.audit = {};
	fixture.sort = null;
	fixture.columns = [];
});

describe("usage table sorting", () => {
	it("keeps readable minimum column widths inside the installed Basalt scroll region", () => {
		fixture.usage = { loaded: true, items: [base] };
		const html = render("usage");
		const widths = ["16ch", "18ch", "14ch", "14ch", "12ch", "14ch", "14ch", "14ch"];
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
		expect(html).toContain("relative min-w-0 overflow-auto");
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
	for (const label of ["写入次数", "输入字节", "输出字节"]) expect(html).toContain(label);
	for (const fake of ["D1 占用", "待同步向量", "最近定时任务", "P50", "P95"])
		expect(html).not.toContain(fake);
	expect(html).toMatch(/<td[^>]*>123<\/td>/);
	expect(html).toMatch(/<td[^>]*>456<\/td>/);
});
