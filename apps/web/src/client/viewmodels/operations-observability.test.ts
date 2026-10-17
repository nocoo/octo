import { describe, expect, it, vi } from "vitest";
import {
	AuditModel,
	auditCsv,
	auditQuery,
	parseAuditFilters,
	parseUsageFilters,
	UsageModel,
	usageQuery,
	virtualWindow,
} from "./operations-observability";

const daily = [
	{ day: "2026-10-17", key_id: "key-a", calls: 10, errors: 2, p50_ms: 20, p95_ms: 50 },
];
const health = { d1_bytes: 1000, vector_backlog: 3, cron_last_run_at: null };
const row = {
	id: "1",
	at: 0,
	actor: "key:a",
	method: "GET",
	route: "/api/v1/memories",
	status: 200,
	error_code: null,
	request_id: "r1",
	duration_ms: 12,
};

describe("URL filter contracts", () => {
	it("round-trips audit filters, strips unknown/invalid values and encodes delimiters", () => {
		const filters = {
			actor: "admin:a+b@example.com",
			route: "/api/v1/memories",
			status: "403",
			from: "2026-10-01",
			to: "2026-10-17",
		};
		expect(parseAuditFilters(auditQuery(filters))).toEqual(filters);
		expect(parseAuditFilters("?status=999&from=bad&to=bad&actor=%20&unknown=x")).toEqual({
			actor: "",
			route: "",
			status: "",
			from: "",
			to: "",
		});
		expect(auditQuery(parseAuditFilters(""))).toBe("");
		expect(
			parseUsageFilters(usageQuery({ key_id: "key/a", from: "2026-10-01", to: "2026-10-17" })),
		).toEqual({ key_id: "key/a", from: "2026-10-01", to: "2026-10-17" });
		expect(usageQuery(parseUsageFilters(""))).toBe("");
	});
});

describe("usage health model", () => {
	it("ignores rejected requests after disposal", async () => {
		let reject: (reason: Error) => void = () => {};
		const request = vi.fn().mockImplementationOnce(
			() =>
				new Promise((_, fail) => {
					reject = fail;
				}),
		);
		const model = new UsageModel({ request });
		const pending = model.load();
		model.dispose();
		reject(new Error("private"));
		await pending;
		expect(model.state.error).toBeNull();
	});
	it("loads server-filtered data with per-row error rates and chart data", async () => {
		const request = vi.fn().mockResolvedValue({
			daily: [
				...daily,
				{ ...daily[0], day: "2026-10-18", calls: 0, errors: 0, p50_ms: null, p95_ms: null },
			],
			health,
		});
		const model = new UsageModel({ request });
		expect(model.state.loaded).toBe(false);
		await model.load("?key_id=key-a&from=2026-10-01");
		expect(request).toHaveBeenCalledWith("/usage?key_id=key-a&from=2026-10-01");
		expect(model.rows.map((r) => r.error_rate)).toEqual([20, 0]);
		expect(model.chart[0]).toEqual({
			x: "2026-10-17 / key-a",
			calls: 10,
			error_rate: 20,
			p50_ms: 20,
			p95_ms: 50,
		});
		expect(model.state.health).toEqual(health);
		expect(model.state.loaded).toBe(true);
	});

	it("retains old data on refresh errors, rejects reversed ranges, and ignores stale results", async () => {
		let finish: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockResolvedValueOnce({ daily, health })
			.mockRejectedValueOnce(new Error("secret"));
		const model = new UsageModel({ request });
		await model.load();
		await model.load();
		expect(model.state.daily).toEqual(daily);
		expect(model.state.error).toBe("Unable to load usage and health.");
		await model.load("from=2026-10-18&to=2026-10-01");
		expect(request).toHaveBeenCalledTimes(2);
		expect(model.state.filters.from).toBe("2026-10-18");
		expect(model.state.daily).toEqual([]);
		request
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValueOnce({ daily: [], health });
		const pending = model.load();
		await model.load("key_id=new");
		finish({ daily, health });
		await pending;
		expect(model.state.daily).toEqual([]);
		model.dispose();
	});
});

describe("audit query, virtualization and CSV", () => {
	it("certifies successful current-filter reads and preserves cached rows/cursor on refresh failure", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error("private"))
			.mockResolvedValueOnce({ items: [row], next_cursor: "older" })
			.mockRejectedValueOnce(new Error("private"))
			.mockRejectedValueOnce(new Error("private"))
			.mockResolvedValueOnce({ items: [], next_cursor: null });
		const model = new AuditModel({ request });
		expect(model.state).toMatchObject({ loaded: false });
		await model.load();
		expect(model.state).toMatchObject({ loaded: false, error: "Unable to load audit log." });
		await model.load();
		await model.load();
		expect(model.state).toMatchObject({
			loaded: true,
			items: [row],
			nextCursor: "older",
			error: "Unable to load audit log.",
		});
		await model.load("status=500");
		expect(model.state).toMatchObject({ loaded: false, items: [], nextCursor: null });
		await model.load("status=500");
		expect(model.state).toMatchObject({ loaded: true, items: [], error: null });
	});
	it("ignores stale initial loads, rejected pages, and cancelled exports", async () => {
		for (const action of ["load", "loadMore", "exportCsv"] as const) {
			for (const fail of [false, true]) {
				let resolve: (value: unknown) => void = () => {};
				let reject: (reason: Error) => void = () => {};
				const request = vi.fn().mockResolvedValueOnce({ items: [], next_cursor: "a" });
				const model = new AuditModel({ request });
				await model.load();
				request.mockImplementationOnce(
					() =>
						new Promise((done, failed) => {
							resolve = done;
							reject = failed;
						}),
				);
				const pending = model[action]();
				model.dispose();
				if (fail) reject(new Error("secret"));
				else resolve({ items: [row], next_cursor: null });
				await pending;
				expect(model.state.items).toEqual([]);
				expect(model.state.error).toBeNull();
			}
		}
	});
	it("quotes CSV, neutralizes formula injection and omits unknown sensitive properties", () => {
		const csv = auditCsv([
			{ ...row, actor: '=HYPERLINK("bad")', route: 'a,"b"\nc', error_code: "@danger" },
			{ ...row, actor: " \t+formula", route: "-formula", error_code: "\tformula" },
		]);
		expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
		expect(csv).toContain('"a,""b""\nc"');
		expect(csv).toContain('"\'@danger"');
		expect(csv).toContain('"\' \t+formula"');
		expect(csv).toContain('"\'-formula"');
		expect(csv).toContain('"\'\tformula"');
		expect(csv).toContain('"1970-01-01T00:00:00.000Z"');
		expect(auditCsv([]).split("\r\n")).toHaveLength(1);
	});

	it("bounds virtual rows with overscan at both ends", () => {
		expect(virtualWindow(1000, 360, 180, 36)).toEqual({
			start: 5,
			end: 20,
			before: 180,
			after: 35280,
		});
		expect(virtualWindow(2, -100, 300, 36)).toEqual({ start: 0, end: 2, before: 0, after: 0 });
		expect(virtualWindow(100, 99999, 300, 36).end).toBe(100);
		expect(virtualWindow(0, 0, 0, 0)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
	});

	it("loads URL filters and cursor pages, deduplicating by stable row id", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items: [row], next_cursor: "cursor+/" })
			.mockResolvedValueOnce({ items: [row, { ...row, id: "2" }], next_cursor: null });
		const model = new AuditModel({ request });
		await model.load("actor=key%3Aa");
		expect(request).toHaveBeenCalledWith("/audit?actor=key%3Aa&limit=200");
		await model.loadMore();
		expect(request).toHaveBeenCalledWith("/audit?actor=key%3Aa&limit=200&cursor=cursor%2B%2F");
		expect(model.state.items).toEqual([row, { ...row, id: "2" }]);
		await model.loadMore();
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("exports all matching pages, excludes cursor from filters and reports failures safely", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items: [row], next_cursor: "a" })
			.mockResolvedValueOnce({ items: [row], next_cursor: "a" })
			.mockResolvedValueOnce({ items: [{ ...row, id: "2" }], next_cursor: null });
		const model = new AuditModel({ request });
		await model.load("status=200&cursor=old");
		const csv = await model.exportCsv();
		expect(csv?.split("\r\n")).toHaveLength(3);
		expect(request.mock.calls[1]?.[0]).toBe("/audit?status=200&limit=200");
		request.mockRejectedValueOnce(new Error("sensitive"));
		expect(await model.exportCsv()).toBeNull();
		expect(model.state.error).toBe("Unable to export audit log.");
		request.mockResolvedValue({ items: [], next_cursor: "repeat" });
		expect(await model.exportCsv()).toBeNull();
		expect(model.state.exporting).toBe(false);
	});

	it("preserves refresh rows, clears changed filters, reports read/page errors and validates range", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items: [row], next_cursor: "a" })
			.mockRejectedValueOnce(new Error("secret"))
			.mockRejectedValueOnce(new Error("secret"));
		const model = new AuditModel({ request });
		await model.load();
		await model.loadMore();
		expect(model.state.items).toEqual([row]);
		expect(model.state.error).toBe("Unable to load audit log.");
		await model.load();
		expect(model.state.items).toEqual([row]);
		request.mockRejectedValueOnce(new Error("secret"));
		await model.load("status=500");
		expect(model.state.items).toEqual([]);
		await model.load("from=2026-10-18&to=2026-10-01");
		expect(model.state.error).toBe("Start time must not follow end time.");
		expect(model.state.items).toEqual([]);
		const before = request.mock.calls.length;
		expect(await model.exportCsv()).toBeNull();
		expect(request).toHaveBeenCalledTimes(before);
	});

	it("ignores stale page/export responses and locks duplicate in-flight calls", async () => {
		let finish: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items: [row], next_cursor: "a" })
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			);
		const model = new AuditModel({ request });
		await model.load();
		const page = model.loadMore();
		await model.loadMore();
		request.mockResolvedValueOnce({ items: [], next_cursor: null });
		await model.load("status=404");
		finish({ items: [row], next_cursor: null });
		await page;
		expect(model.state.items).toEqual([]);
		request.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const exporting = model.exportCsv();
		expect(await model.exportCsv()).toBeNull();
		model.dispose();
		finish({ items: [row], next_cursor: null });
		expect(await exporting).toBeNull();
		expect(model.state.exporting).toBe(false);
	});
});
