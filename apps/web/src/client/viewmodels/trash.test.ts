import { describe, expect, it, vi } from "vitest";
import { type AdminClient, ApiError, type RequestOptions } from "../lib/api";
import type { LibraryMemory } from "./library";
import {
	readTrashFilters,
	readTrashSelection,
	selectAllTrash,
	setTrashFilter,
	setTrashPageSelection,
	TrashModel,
} from "./trash";

const memory = (id: string): LibraryMemory => ({
	id,
	title: id,
	space: "work",
	tags: [],
	version: 1,
	created_at: "2026-10-17T00:00:00Z",
	event_time: null,
});
const page = (ids: string[], total = ids.length, next_cursor: string | null = null) => ({
	items: ids.map(memory),
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

describe("trash URL state", () => {
	it("normalizes filters, preserves unrelated state and clears selections on filter changes", () => {
		const params = new URLSearchParams(
			"q=+词+&space=work&selected=a&selected=a&selected=&theme=dark",
		);
		expect(readTrashFilters(params)).toEqual({ q: "词", space: "work" });
		expect(readTrashSelection(params)).toEqual(selected(["a"]));
		const changed = setTrashFilter(selectAllTrash(params), "q", "new");
		expect(changed.toString()).toBe("q=new&space=work&theme=dark");
		expect(setTrashFilter(changed, "space", "").has("space")).toBe(false);
		expect(readTrashFilters(new URLSearchParams())).toEqual({});
	});
	it("selects the page only, preserves other pages and supports exclusions from all matching", () => {
		const original = new URLSearchParams("selected=older");
		const next = setTrashPageSelection(original, ["a", "b"], true);
		expect(readTrashSelection(next)).toEqual(selected(["older", "a", "b"]));
		expect(readTrashSelection(setTrashPageSelection(next, ["a", "b"], false))).toEqual(
			selected(["older"]),
		);
		const every = selectAllTrash(next);
		expect(readTrashSelection(every)).toEqual(all);
		const excluded = setTrashPageSelection(every, ["a"], false);
		expect(readTrashSelection(excluded)).toEqual({ ...all, excluded: ["a"] });
		expect(readTrashSelection(setTrashPageSelection(excluded, ["a"], true))).toEqual(all);
	});
});

describe("trash server filtering and pagination", () => {
	it("uses exact server totals and filters, with one page displayed and cursor history", async () => {
		const { api, request } = fake([
			page(["a"], 30, "signed/next"),
			page(["b"], 30),
			page(["a"], 30, "signed/next"),
		]);
		const model = new TrashModel(api);
		expect(await model.load({ q: "词", space: "work" })).toBe(true);
		expect(request.mock.calls[0]?.[0]).toBe("/trash?limit=25&q=%E8%AF%8D&space=work");
		expect(model.state).toMatchObject({ total: 30, page: 1, ready: true });
		expect(await model.nextPage()).toBe(true);
		expect(model.state.memories.map((item) => item.id)).toEqual(["b"]);
		expect(request.mock.calls[1]?.[0]).toContain("cursor=signed%2Fnext");
		expect(await model.previousPage()).toBe(true);
		expect(model.state.page).toBe(1);
		expect(await model.previousPage()).toBe(false);
	});
	it("ignores obsolete successful and failed loads without losing the current filter", async () => {
		const first = deferred();
		const second = deferred();
		const { api, request } = fake([page(["fresh"])]);
		request
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);
		const model = new TrashModel(api);
		const old = model.load({ q: "old" });
		const obsolete = model.load({ q: "obsolete" });
		expect(await model.load({ q: "fresh" })).toBe(true);
		first.resolve(page(["stale"]));
		second.reject(new Error("private failure"));
		expect(await old).toBe(false);
		expect(await obsolete).toBe(false);
		expect(model.state).toMatchObject({ filters: { q: "fresh" }, error: null, loading: false });
		expect(model.state.memories.map((item) => item.id)).toEqual(["fresh"]);
	});
	it("preserves cached rows on refresh failure and separates space lookup errors", async () => {
		const { api } = fake([
			page(["a"]),
			new ApiError(503, "unavailable"),
			new Error("secret"),
			{ items: [{ slug: "work", name: "工作" }] },
		]);
		const model = new TrashModel(api);
		await model.load();
		expect(await model.load()).toBe(false);
		expect(model.state.memories).toHaveLength(1);
		expect(model.state.error).toContain("服务暂时不可用");
		await model.loadSpaces();
		expect(model.state.spacesError).toContain("请求失败");
		await model.loadSpaces();
		expect(model.state.spaces).toEqual([{ slug: "work", name: "工作" }]);
		expect(model.state.spacesError).toBeNull();
	});
});

describe("trash bulk mutations", () => {
	it("restores selected ids with per-id results, progress and partial failures", async () => {
		const { api, request } = fake([
			page(["a", "b"]),
			{
				results: [
					{ id: "b", ok: false, error: { code: "version_conflict" } },
					{ id: "a", ok: true },
				],
			},
			page(["b"]),
		]);
		const model = new TrashModel(api);
		await model.load();
		expect(await model.restore(selected(["a", "a", "b"]))).toBe(true);
		expect(request).toHaveBeenCalledWith("/trash:batchRestore", {
			method: "POST",
			json: { ids: ["a", "b"] },
		});
		expect(model.state).toMatchObject({
			succeeded: ["a"],
			total: 1,
			progress: { processed: 2, total: 2 },
			busy: false,
		});
		expect(model.state.failures).toEqual([{ id: "b", message: "内容已被修改，请刷新后重试。" }]);
		expect(model.state.notice).toBe("已恢复 1 / 2 条记忆");
	});
	it("freezes all matching IDs before confirming purge, excludes unchecked rows and sends bounded batches", async () => {
		const ids = Array.from({ length: 205 }, (_, index) => `memory-${index}`);
		const { api, request } = fake([
			page(ids.slice(0, 25), 205, "list"),
			page(ids.slice(0, 200), 205, "selection"),
			page(ids.slice(200), 205),
			{ results: results(ids.slice(1, 101)) },
			{ results: results(ids.slice(101, 201)) },
			{ results: results(ids.slice(201)) },
			page([ids[0] as string]),
		]);
		const model = new TrashModel(api);
		await model.load({ q: "memory", space: "work" });
		expect(await model.preparePurge({ ...all, excluded: ["memory-0"] })).toBe(true);
		expect(model.state.confirmation).toMatchObject({
			kind: "purge",
			count: 204,
			filters: { q: "memory", space: "work" },
		});
		expect(request.mock.calls.every((call) => String(call[0]).startsWith("/trash?"))).toBe(true);
		expect(await model.confirm()).toBe(true);
		const writes = request.mock.calls.filter((call) => call[0] === "/trash:batchPurge");
		expect(writes.map((call) => (call[1] as { json: { ids: string[] } }).json.ids.length)).toEqual([
			100, 100, 4,
		]);
		expect(model.state).toMatchObject({
			succeeded: ids.slice(1),
			confirmation: null,
			progress: { processed: 204, total: 204 },
		});
	});
	it.each([
		[page(["a"], 2), "筛选范围"],
		[page(["a"], 1, "repeat"), "筛选范围"],
	])(
		"refuses changed or inconsistent selection snapshots before any mutation",
		async (reply, message) => {
			const { api, request } = fake([page(["a"]), reply]);
			const model = new TrashModel(api);
			await model.load();
			expect(await model.preparePurge(all)).toBe(false);
			expect(model.state.error).toContain(message);
			expect(request.mock.calls).toHaveLength(2);
			expect(model.state.confirmation).toBeNull();
		},
	);
	it("cancels obsolete selection preparation and never opens a confirmation for old filters", async () => {
		const pending = deferred();
		const { api, request } = fake([page(["a"]), page(["b"])]);
		const model = new TrashModel(api);
		await model.load();
		request.mockImplementationOnce(() => pending.promise);
		const preparation = model.preparePurge(all);
		await model.load({ q: "new" });
		pending.resolve(page(["a"]));
		expect(await preparation).toBe(false);
		expect(model.state.confirmation).toBeNull();
		expect(model.state.preparing).toBe(false);
	});
	it("keeps successful chunks after transport failure and reports every unprocessed id", async () => {
		const ids = Array.from({ length: 101 }, (_, index) => String(index));
		const { api } = fake([
			page(ids),
			{ results: results(ids.slice(0, 100)) },
			new Error("offline"),
			page(["100"]),
		]);
		const model = new TrashModel(api);
		await model.load();
		expect(await model.restore(selected(ids))).toBe(false);
		expect(model.state.succeeded).toHaveLength(100);
		expect(model.state.failures).toEqual([
			{ id: "100", message: "未确认处理结果，请刷新后重试。" },
		]);
		expect(model.state.notice).toBe("已恢复 100 / 101 条记忆");
	});
});

describe("trash empty and single confirmation", () => {
	it("retains completed single-purge safeguards after failure and retries without another title entry", async () => {
		const { api, request } = fake([
			page(["a"]),
			new ApiError(503, "unavailable"),
			{ purged: true },
			page([]),
		]);
		const model = new TrashModel(api);
		await model.load();
		model.beginPurge("a");
		model.confirmTitle("a");
		const confirmation = model.state.confirmation;
		expect(await model.confirm()).toBe(false);
		expect(model.state.confirmation).toEqual(confirmation);
		expect(model.state).toMatchObject({
			busy: false,
			notice: null,
			error: "服务暂时不可用，请稍后重试。",
		});
		expect(request).toHaveBeenCalledTimes(2);
		expect(await model.confirm()).toBe(true);
		expect(model.state).toMatchObject({ confirmation: null, error: null });
		expect(request.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(
			2,
		);
	});
	it("confirms exact filtered count and loops with original count and filter scope", async () => {
		const { api, request } = fake([
			page(["a", "b"], 2),
			{ results: results(["a"]), purged: 1, remaining: 1, next_cursor: "signed" },
			{ results: results(["b"]), purged: 1, remaining: 0, next_cursor: null },
			page([]),
		]);
		const model = new TrashModel(api);
		await model.load({ q: "tag", space: "work" });
		expect(model.prepareEmpty()).toBe(true);
		expect(model.state.confirmation).toMatchObject({
			kind: "empty",
			count: 2,
			filters: { q: "tag", space: "work" },
		});
		expect(await model.confirm()).toBe(true);
		expect(request).toHaveBeenCalledWith("/trash:empty", {
			method: "POST",
			json: { filters: { q: "tag", space: "work" }, expected_count: 2 },
		});
		expect(request).toHaveBeenCalledWith("/trash:empty", {
			method: "POST",
			json: { filters: { q: "tag", space: "work" }, expected_count: 2, cursor: "signed" },
		});
		expect(model.state.notice).toBe("已彻底删除 2 / 2 条记忆");
	});
	it("stops on count conflict and requires a fresh confirmation", async () => {
		const { api, request } = fake([
			page(["a"]),
			new ApiError(409, "version_conflict"),
			page(["a", "new"]),
		]);
		const model = new TrashModel(api);
		await model.load();
		model.prepareEmpty();
		expect(await model.confirm()).toBe(false);
		expect(model.state.error).toContain("重新确认");
		expect(model.state.confirmation).toBeNull();
		expect(await model.confirm()).toBe(false);
		expect(request.mock.calls.filter((call) => call[0] === "/trash:empty")).toHaveLength(1);
	});
	it.each(["retry", null])(
		"stops partial failure with cursor %s rather than retrying forever",
		async (nextCursor) => {
			const { api, request } = fake([
				page(["a"]),
				{
					results: [{ id: "a", ok: false, error: { code: "unavailable" } }],
					purged: 0,
					remaining: 1,
					next_cursor: nextCursor,
				},
				page(["a"]),
			]);
			const model = new TrashModel(api);
			await model.load();
			model.prepareEmpty();
			expect(await model.confirm()).toBe(true);
			expect(model.state.failures).toEqual([{ id: "a", message: "服务暂时不可用，请稍后重试。" }]);
			expect(request.mock.calls.filter((call) => call[0] === "/trash:empty")).toHaveLength(1);
		},
	);
	it("retains the single title confirmation and locks mutations and cancellation in flight", async () => {
		const pending = deferred();
		const { api, request } = fake([page(["a"]), page([])]);
		const model = new TrashModel(api);
		await model.load();
		expect(model.beginPurge("missing")).toBe(false);
		expect(model.beginPurge("a")).toBe(true);
		expect(await model.confirm()).toBe(false);
		expect(model.confirmTitle("wrong")).toBe(false);
		expect(model.confirmTitle("a")).toBe(true);
		request.mockImplementationOnce(() => pending.promise);
		const purging = model.confirm();
		model.cancelConfirmation();
		expect(model.state.confirmation?.kind).toBe("single");
		expect(await model.load({ q: "changed" })).toBe(false);
		expect(await model.restore(selected(["a"]))).toBe(false);
		pending.resolve({ id: "a", purged: true });
		expect(await purging).toBe(true);
		expect(request).toHaveBeenCalledWith("/trash/a", { method: "DELETE" });
		expect(model.state.confirmation).toBeNull();
	});
});
