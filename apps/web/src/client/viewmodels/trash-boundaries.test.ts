import { describe, expect, it, vi } from "vitest";
import { type AdminClient, ApiError, type RequestOptions } from "../lib/api";
import { TrashModel, trashScope } from "./trash";

const page = (ids: string[], total = ids.length, next_cursor: string | null = null) => ({
	items: ids.map((id) => ({
		id,
		title: id,
		space: "work",
		tags: [],
		version: 1,
		created_at: "2026-10-17T00:00:00Z",
		event_time: null,
	})),
	total,
	next_cursor,
});
const selected = (ids: string[]) => ({ ids, all: false, excluded: [] });
const all = { ids: [], all: true, excluded: [] };
const results = (ids: string[]) => ids.map((id) => ({ id, ok: true }));
function fake(replies: unknown[]) {
	const request = vi.fn(async (_path: string, _options?: RequestOptions) => {
		const reply = replies.shift();
		if (reply instanceof Error) throw reply;
		return reply;
	});
	return { api: { request } as AdminClient, request };
}
function deferred() {
	let resolve!: (value: unknown) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe("trash async boundaries and retry safety", () => {
	it.each([
		{ results: results(["a"]), purged: 0.5, remaining: 0, next_cursor: null },
		{ results: [{ id: "a", ok: false }], purged: 0, remaining: 0.5, next_cursor: null },
		{ results: [{ id: "a", ok: false }], purged: Number.NaN, remaining: 1, next_cursor: null },
		{ results: results(["a"]), purged: -1, remaining: 0, next_cursor: null },
		{ results: results(["a"]), purged: 0, remaining: -1, next_cursor: null },
		{ results: results(["a"]), purged: 0, remaining: Infinity, next_cursor: null },
		{ results: [{ id: "a", ok: false }], purged: 0, remaining: 2, next_cursor: null },
	])("rejects noninteger counts even when the response includes failures", async (reply) => {
		const { api, request } = fake([page(["a"]), reply, page(["a"])]);
		const model = new TrashModel(api);
		await model.load();
		model.prepareEmpty();
		expect(await model.confirm()).toBe(false);
		expect(model.state.error).toContain("处理进度异常");
		expect(request.mock.calls.filter((call) => call[0] === "/trash:empty")).toHaveLength(1);
	});
	it.each([
		[3, ["a"], "next"],
		[1, ["b"], null],
	])(
		"rejects duplicate or expanding work across empty continuations",
		async (total, ids, cursor) => {
			const { api, request } = fake([
				page(["a"], total),
				{ results: results(["a"]), purged: 0, remaining: 1, next_cursor: "first" },
				{ results: results(ids), purged: 0, remaining: 0, next_cursor: cursor },
				page([]),
			]);
			const model = new TrashModel(api);
			await model.load();
			model.prepareEmpty();
			expect(await model.confirm()).toBe(false);
			expect(model.state.error).toContain("处理进度异常");
			expect(model.state.succeeded).toEqual(["a"]);
			expect(request.mock.calls.filter((call) => call[0] === "/trash:empty")).toHaveLength(2);
		},
	);
	it("bounds each empty response and rejects duplicate results or expanding snapshot work", async () => {
		const ids = Array.from({ length: 101 }, (_, index) => String(index));
		for (const [total, reply] of [
			[101, { results: results(ids), purged: 101, remaining: 0, next_cursor: null }],
			[2, { results: results(["a", "a"]), purged: 2, remaining: 0, next_cursor: null }],
			[1, { results: results(["a", "b"]), purged: 0, remaining: 0, next_cursor: null }],
		] as const) {
			const { api } = fake([page(["a"], total), reply, page([])]);
			const model = new TrashModel(api);
			await model.load();
			model.prepareEmpty();
			expect(await model.confirm()).toBe(false);
			expect(model.state.error).toContain("处理进度异常");
		}
	});
	it("accepts idempotent missing purge results and reduced original-snapshot eligibility", async () => {
		const { api, request } = fake([
			page(["a", "b", "c"]),
			{ results: results(["a"]), purged: 0, remaining: 1, next_cursor: "next" },
			{ results: results(["c"]), purged: 1, remaining: 0, next_cursor: null },
			page(["new-trash"]),
		]);
		const model = new TrashModel(api);
		await model.load();
		model.prepareEmpty();
		expect(await model.confirm()).toBe(true);
		expect(request.mock.calls.filter((call) => call[0] === "/trash:empty")).toHaveLength(2);
		expect(model.state).toMatchObject({ succeeded: ["a", "c"], purged: 1, total: 1 });
		expect(model.state.notice).toBe("已彻底删除 1 / 3 条记忆");
	});
	it("describes unrestricted and filtered destructive scopes", () => {
		expect(trashScope({})).toBe("全部空间，不限关键词");
		expect(trashScope({ q: "合同", space: "work" })).toBe("空间「work」，标题或标签包含「合同」");
	});
	it("keeps a failed page retryable, detects a cursor cycle and rejects overlapping pagination", async () => {
		const next = deferred();
		const { api, request } = fake([
			page(["a"], 30, "next"),
			new ApiError(503, "unavailable"),
			page(["b"], 30, "next"),
		]);
		const model = new TrashModel(api);
		await model.load();
		expect(await model.nextPage()).toBe(false);
		expect(model.state).toMatchObject({ page: 1, nextCursor: "next", loading: false });
		expect(await model.nextPage()).toBe(false);
		expect(model.state.error).toContain("分页游标重复");
		request.mockImplementationOnce(() => next.promise);
		const navigation = model.nextPage();
		expect(await model.nextPage()).toBe(false);
		expect(await model.preparePurge(all)).toBe(false);
		expect(model.prepareEmpty()).toBe(false);
		expect(model.beginPurge("a")).toBe(false);
		model.dispose();
		next.resolve(page(["late"]));
		expect(await navigation).toBe(false);
		expect(model.state.memories.map((item) => item.id)).toEqual(["a"]);
	});
	it("does not replace spaces with obsolete successes or failures", async () => {
		const old = deferred();
		const obsolete = deferred();
		const { api, request } = fake([{ items: [{ slug: "fresh", name: "新空间" }] }]);
		request
			.mockImplementationOnce(() => old.promise)
			.mockImplementationOnce(() => obsolete.promise);
		const model = new TrashModel(api);
		const first = model.loadSpaces();
		const second = model.loadSpaces();
		await model.loadSpaces();
		old.resolve({ items: [{ slug: "old" }] });
		obsolete.reject(new Error("obsolete"));
		await Promise.all([first, second]);
		expect(model.state.spaces).toEqual([{ slug: "fresh", name: "新空间" }]);
		expect(model.state.spacesError).toBeNull();
	});
	it("refuses actions without ready data or selection", async () => {
		const { api, request } = fake([page([]), page([])]);
		const model = new TrashModel(api);
		expect(await model.preparePurge(all)).toBe(false);
		expect(await model.restore(selected(["a"]))).toBe(false);
		expect(model.prepareEmpty()).toBe(false);
		expect(model.confirmTitle("a")).toBe(false);
		expect(await model.nextPage()).toBe(false);
		expect(await model.confirm()).toBe(false);
		expect(request).not.toHaveBeenCalled();
		await model.load();
		expect(model.prepareEmpty()).toBe(false);
		expect(await model.restore(selected([]))).toBe(false);
		expect(model.state.error).toBe("请选择当前筛选范围内的记忆。");
	});
	it.each([
		[page(["a", "a"], 2), "筛选范围"],
		[page(["a"], 2), "筛选范围"],
		[new ApiError(409, "version_conflict"), "重新确认"],
		[new ApiError(503, "unavailable"), "暂时不可用"],
	])(
		"rejects incomplete, duplicate or conflicting selection enumeration",
		async (reply, message) => {
			const { api } = fake([page(["a", "b"]), reply]);
			const model = new TrashModel(api);
			await model.load();
			expect(await model.preparePurge(all)).toBe(false);
			expect(model.state.error).toContain(message);
			expect(model.state.confirmation).toBeNull();
		},
	);
	it("validates deep-linked selection against the full filter range", async () => {
		const { api } = fake([
			page(["a"], 2, "later"),
			page(["a", "b"]),
			page(["a", "b"]),
			page(["a", "b"]),
		]);
		const model = new TrashModel(api);
		await model.load();
		expect(await model.preparePurge(selected(["b"]))).toBe(true);
		expect(model.state.confirmation?.ids).toEqual(["b"]);
		model.cancelConfirmation();
		expect(model.state.confirmation).toBeNull();
		expect(await model.preparePurge(selected(["outside"]))).toBe(false);
		expect(model.state.error).toBe("请选择当前筛选范围内的记忆。");
		expect(await model.preparePurge({ ...all, excluded: ["a", "b"] })).toBe(false);
	});
	it("invalidates same-filter async preparation when URL selection changes", async () => {
		const pending = deferred();
		const { api, request } = fake([page(["a"])]);
		const model = new TrashModel(api);
		await model.load();
		model.selectionChanged("all");
		request.mockImplementationOnce(() => pending.promise);
		const preparation = model.preparePurge(all);
		model.selectionChanged("all");
		expect(model.state.preparing).toBe(true);
		model.selectionChanged("a");
		pending.resolve(page(["a"]));
		expect(await preparation).toBe(false);
		expect(model.state).toMatchObject({ preparing: false, confirmation: null });
	});
	it("restores all matching and reports omitted per-id outcomes", async () => {
		const { api } = fake([
			page(["a", "b"]),
			page(["a", "b"]),
			{ results: [{ id: "b", ok: true }] },
			page(["a"]),
		]);
		const model = new TrashModel(api);
		await model.load();
		expect(await model.restore(all)).toBe(true);
		expect(model.state.succeeded).toEqual(["b"]);
		expect(model.state.failures).toEqual([{ id: "a", message: "未收到这条记忆的处理结果。" }]);
	});
	it("never sends the next destructive chunk after disposal", async () => {
		const pending = deferred();
		const ids = Array.from({ length: 101 }, (_, index) => String(index));
		const { api, request } = fake([page(ids)]);
		const model = new TrashModel(api);
		await model.load();
		await model.preparePurge(selected(ids));
		request.mockImplementationOnce(() => pending.promise);
		const purging = model.confirm();
		model.selectionChanged("new selection");
		expect(model.confirmTitle("a")).toBe(false);
		model.dispose();
		pending.resolve({ results: results(ids.slice(0, 100)) });
		expect(await purging).toBe(false);
		expect(request.mock.calls.filter((call) => call[0] === "/trash:batchPurge")).toHaveLength(1);
	});
	it("keeps committed successes through failed refresh and preserves earlier errors", async () => {
		const { api, request } = fake([
			page(["a"]),
			{ results: results(["a"]) },
			new Error("refresh"),
			new Error("second refresh"),
		]);
		const model = new TrashModel(api);
		await model.load();
		expect(await model.restore(selected(["a"]))).toBe(true);
		expect(model.state.succeeded).toEqual(["a"]);
		expect(model.state.error).toContain("操作结果已保留，但刷新失败");
		request.mockImplementationOnce(async () => {
			throw null;
		});
		expect(await model.restore(selected(["a"]))).toBe(false);
		expect(model.state.error).toBe("请求失败，请稍后重试。");
	});
	it("does not update the view after disposal during post-commit refresh", async () => {
		const refresh = deferred();
		const { api, request } = fake([page(["a"])]);
		const model = new TrashModel(api);
		await model.load();
		request
			.mockImplementationOnce(async () => ({ results: results(["a"]) }))
			.mockImplementationOnce(() => refresh.promise);
		const restoring = model.restore(selected(["a"]));
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
		model.dispose();
		refresh.resolve(page([]));
		expect(await restoring).toBe(true);
		expect(model.state.memories).toHaveLength(1);
	});
	it.each([
		{ results: results(["a"]), purged: 2, remaining: 0, next_cursor: null },
		{ results: results(["a"]), purged: 1, remaining: 1, next_cursor: null },
		{ results: [], purged: 0, remaining: 1, next_cursor: "stalled" },
		{ results: [], purged: 0, remaining: 1, next_cursor: null },
	])("stops inconsistent empty responses before another call", async (reply) => {
		const { api, request } = fake([page(["a"]), reply, page(["a"])]);
		const model = new TrashModel(api);
		await model.load();
		model.prepareEmpty();
		expect(await model.confirm()).toBe(false);
		expect(model.state.error).toContain("处理进度异常");
		expect(request.mock.calls.filter((call) => call[0] === "/trash:empty")).toHaveLength(1);
	});
	it("stops repeated cursors even when each response claims progress", async () => {
		const { api, request } = fake([
			page(["a", "b", "c"]),
			{ results: results(["a"]), purged: 1, remaining: 2, next_cursor: "repeat" },
			{ results: results(["b"]), purged: 1, remaining: 1, next_cursor: "repeat" },
			page(["c"]),
		]);
		const model = new TrashModel(api);
		await model.load();
		model.prepareEmpty();
		expect(await model.confirm()).toBe(false);
		expect(model.state.succeeded).toEqual(["a", "b"]);
		expect(request.mock.calls.filter((call) => call[0] === "/trash:empty")).toHaveLength(2);
	});
});
