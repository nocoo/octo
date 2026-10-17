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
	p50_ms: null,
	p95_ms: null,
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
	it.each([
		["calls", "calls"],
		["errors", "errors"],
		["rate", "errors"],
		["p50", "p50_ms"],
		["p95", "p95_ms"],
	] as const)("sorts %s numerically rather than as formatted text", (id, field) => {
		fixture.usage = {
			loaded: true,
			daily: [
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
			daily: [
				{ ...base, p50_ms: 10, p95_ms: 10, day: "2026-12-01" },
				{ ...base, key_id: "key-two", p50_ms: 2, p95_ms: 2, day: "2026-02-01" },
				{ ...base, key_id: "key-unknown", day: "2027-01-01" },
			],
		};
		for (const id of ["day", "p50", "p95"]) {
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
	it.each([null, "Unable to load audit log."])(
		"keeps an unknown audit query distinct from empty: %s",
		(error) => {
			fixture.audit = { loaded: false, error };
			const html = render("audit");
			expect(html).not.toContain("No audit records match");
			expect(html).not.toContain("End of loaded query");
			if (error) expect(html).toContain(error);
		},
	);

	it("shows successful audit emptiness and retains cached rows and pagination on refresh failure", () => {
		fixture.audit = { loaded: true };
		const empty = render("audit");
		expect(empty).toContain("No audit records match");
		expect(empty).toContain("End of loaded query");
		fixture.audit = {
			loaded: true,
			error: "Unable to load audit log.",
			nextCursor: "older",
			items: [
				{
					id: "a",
					at: 1,
					actor: "cached-actor",
					method: "GET",
					route: "/api/v1/memories",
					status: 200,
					error_code: null,
					request_id: "r",
					duration_ms: 2,
				},
			],
		};
		const html = render("audit");
		expect(html).toContain("cached-actor");
		expect(html).toContain("Unable to load audit log.");
		expect(html).toContain("More records available");
	});

	it.each([null, "Unable to load usage and health."])(
		"does not assert an empty unknown usage query: %s",
		(error) => {
			fixture.usage = { loaded: false, error };
			const html = render("usage");
			expect(html).not.toContain("No usage in this range");
			expect(html).not.toContain("No daily usage records.");
			if (error) expect(html).toContain(error);
		},
	);
});
