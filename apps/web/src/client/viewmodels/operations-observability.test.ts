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
	{
		day: "2026-10-17",
		key_id: "key-a",
		key_name: "Notebook agent",
		calls: 10,
		errors: 2,
		writes: 3,
		bytes_in: 120,
		bytes_out: 240,
	},
];
const row = {
	id: "1",
	at: "1970-01-01T00:00:00.000Z",
	actor: "key:a",
	method: "GET",
	route: "/api/v1/memories",
	status: 200,
	error_code: null,
	request_id: "r1",
	duration_ms: 12,
	bytes_in: null,
	bytes_out: 20,
	ip_hash: null,
};

describe("URL filter contracts", () => {
	it("round-trips audit filters, strips unknown/invalid values and encodes delimiters", () => {
		const filters = {
			actor: "admin:a+b@example.com",
			action: "/api/v1/memories",
			status: "403",
			from: "2026-10-01",
			to: "2026-10-17",
		};
		expect(parseAuditFilters(auditQuery(filters))).toEqual(filters);
		expect(parseAuditFilters("?status=999&from=bad&to=bad&actor=%20&unknown=x")).toEqual({
			actor: "",
			action: "",
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

describe("daily usage contract", () => {
	it.each([
		["AAAAAAAAAAAA", "Notebook agent", "Notebook agent"],
		["BBBBBBBBBBBB", null, "BBBBBBBB"],
		["short", null, "short"],
		["CCCCCCCCCCCC", "", "CCCCCCCC"],
	])("labels key %s without changing its identity", async (keyId, keyName, keyLabel) => {
		const request = vi.fn().mockResolvedValue({
			items: [{ ...daily[0], key_id: keyId, key_name: keyName }],
			next_cursor: null,
		});
		const model = new UsageModel({ request });
		await model.load();
		expect(model.rows[0]).toMatchObject({ key_id: keyId, key_name: keyName, key_label: keyLabel });
		expect(model.chart).toEqual([{ x: `2026-10-17 / ${keyLabel}`, calls: 10, error_rate: 20 }]);
		expect(request).toHaveBeenCalledTimes(1);
	});

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
	it("loads real daily rows and follows filter-bound cursors without inventing metrics", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items: daily, next_cursor: "next+/" })
			.mockResolvedValueOnce({
				items: [{ ...daily[0], day: "2026-10-18", key_name: null, calls: 0, errors: 0 }],
				next_cursor: null,
			});
		const model = new UsageModel({ request });
		expect(model.state.loaded).toBe(false);
		await model.load("?key_id=key-a&from=2026-10-01");
		expect(request).toHaveBeenCalledWith("/usage?key_id=key-a&from=2026-10-01&limit=200");
		await model.loadMore();
		expect(request).toHaveBeenLastCalledWith(
			"/usage?key_id=key-a&from=2026-10-01&limit=200&cursor=next%2B%2F",
		);
		expect(model.rows.map((r) => r.error_rate)).toEqual([20, 0]);
		expect(model.rows.map((item) => item.key_label)).toEqual(["Notebook agent", "key-a"]);
		expect(model.chart).toEqual([
			{ x: "2026-10-17 / Notebook agent", calls: 10, error_rate: 20 },
			{ x: "2026-10-18 / key-a", calls: 0, error_rate: 0 },
		]);
		expect(model.state).not.toHaveProperty("health");
		expect(model.state.loaded).toBe(true);
		await model.loadMore();
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("preserves pages on failure, deduplicates records and ignores stale pagination", async () => {
		let finish: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items: daily, next_cursor: "more" })
			.mockRejectedValueOnce(new Error("private"))
			.mockResolvedValueOnce({
				items: [...daily, { ...daily[0], key_id: "key-b" }],
				next_cursor: "older",
			});
		const model = new UsageModel({ request });
		await model.load();
		await model.loadMore();
		expect(model.state).toMatchObject({
			items: daily,
			nextCursor: "more",
			error: "无法加载每日用量。",
			loadingMore: false,
		});
		await model.loadMore();
		expect(model.state.items).toHaveLength(2);
		request.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const pending = model.loadMore();
		await model.loadMore();
		request.mockResolvedValueOnce({ items: [], next_cursor: null });
		await model.load("key_id=changed");
		finish({ items: daily, next_cursor: null });
		await pending;
		expect(model.state).toMatchObject({ items: [], loaded: true, nextCursor: null });
	});
	it("disposal ignores pagination failures and results", async () => {
		for (const fail of [true, false]) {
			let resolve: (value: unknown) => void = () => {};
			let reject: (reason: Error) => void = () => {};
			const request = vi
				.fn()
				.mockResolvedValueOnce({ items: [], next_cursor: "more" })
				.mockImplementationOnce(
					() =>
						new Promise((done, failed) => {
							resolve = done;
							reject = failed;
						}),
				);
			const model = new UsageModel({ request });
			await model.load();
			const pending = model.loadMore();
			model.dispose();
			if (fail) reject(new Error("private"));
			else resolve({ items: daily, next_cursor: null });
			await pending;
			expect(model.state).toMatchObject({ items: [], error: null, loadingMore: false });
		}
	});

	it("retains old data on refresh errors, rejects reversed ranges, and ignores stale results", async () => {
		let finish: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items: daily, next_cursor: null })
			.mockRejectedValueOnce(new Error("secret"));
		const model = new UsageModel({ request });
		await model.load();
		await model.load();
		expect(model.state.items).toEqual(daily);
		expect(model.state.error).toBe("无法加载每日用量。");
		await model.load("from=2026-10-18&to=2026-10-01");
		expect(request).toHaveBeenCalledTimes(2);
		expect(model.state.filters.from).toBe("2026-10-18");
		expect(model.state.items).toEqual([]);
		request
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValueOnce({ items: [], next_cursor: null });
		const pending = model.load();
		await model.load("key_id=new");
		finish({ items: daily, next_cursor: null });
		await pending;
		expect(model.state.items).toEqual([]);
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
		expect(model.state).toMatchObject({ loaded: false, error: "无法加载审计日志。" });
		await model.load();
		await model.load();
		expect(model.state).toMatchObject({
			loaded: true,
			items: [row],
			nextCursor: "older",
			error: "无法加载审计日志。",
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
		expect(auditCsv([])).toBe(
			'"记录标识","时间","调用者","请求方法","路由","状态码","错误代码","请求标识","耗时（毫秒）"',
		);
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
		expect(model.state.error).toBe("无法导出审计日志。");
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
		expect(model.state.error).toBe("无法加载审计日志。");
		await model.load();
		expect(model.state.items).toEqual([row]);
		request.mockRejectedValueOnce(new Error("secret"));
		await model.load("status=500");
		expect(model.state.items).toEqual([]);
		await model.load("from=2026-10-18&to=2026-10-01");
		expect(model.state.error).toBe("开始时间不能晚于结束时间。");
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
