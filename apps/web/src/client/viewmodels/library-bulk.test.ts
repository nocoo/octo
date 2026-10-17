import { describe, expect, it, vi } from "vitest";
import type { AdminClient } from "../lib/api";
import type { LibraryMemory } from "./library";
import { BulkModel } from "./library-bulk";

const items: LibraryMemory[] = [
	{
		id: "a",
		title: "A",
		space: "work",
		tags: ["one"],
		version: 2,
		created_at: "2026-01-01T00:00:00Z",
		event_time: null,
	},
	{
		id: "b",
		title: "B",
		space: "work",
		tags: [],
		version: 4,
		created_at: "2026-01-01T00:00:00Z",
		event_time: null,
	},
];
const client = (results: unknown[]) => {
	const request = vi.fn(async () => ({ results }));
	return { api: { request } as AdminClient, request };
};
describe("library bulk actions", () => {
	it("appends tags per item with OCC and reports partial failures", async () => {
		const { api, request } = client([
			{ ok: true, item: items[0] },
			{ ok: false, error: { code: "version_conflict", message: "private backend details" } },
		]);
		const model = new BulkModel(api);
		expect(await model.apply(items, ["a", "b", "a"], { kind: "tag", tags: ["one", "two"] })).toBe(
			true,
		);
		expect(request).toHaveBeenCalledWith("/memories:batchUpdate", {
			method: "POST",
			json: {
				items: [
					{ id: "a", expected_version: 2, tags: ["one", "two"] },
					{ id: "b", expected_version: 4, tags: ["one", "two"] },
				],
			},
		});
		expect(model.state.succeeded).toEqual(["a"]);
		expect(model.state.failures).toEqual([{ id: "b", message: "内容已被修改，请刷新后重试。" }]);
	});
	it("moves memories and soft deletes selected IDs", async () => {
		const { api, request } = client([{ ok: true, item: items[0] }]);
		const model = new BulkModel(api);
		await model.apply(items, ["a"], { kind: "move", space: "new" });
		expect(request).toHaveBeenLastCalledWith("/memories:batchUpdate", {
			method: "POST",
			json: { items: [{ id: "a", expected_version: 2, space: "new" }] },
		});
		await model.apply(items, ["b"], { kind: "delete" });
		expect(request).toHaveBeenLastCalledWith("/memories:batchDelete", {
			method: "POST",
			json: { ids: ["b"] },
		});
	});
	it("rejects unavailable, empty, oversized or invalid selection and inputs", async () => {
		const { api, request } = client([]);
		const model = new BulkModel(api);
		for (const ids of [
			[],
			["missing"],
			Array.from({ length: 101 }, (_unused, index) => String(index)),
		])
			expect(await model.apply(items, ids, { kind: "delete" })).toBe(false);
		expect(await model.apply(items, ["a"], { kind: "tag", tags: [" "] })).toBe(false);
		expect(await model.apply(items, ["a"], { kind: "tag", tags: [] })).toBe(false);
		expect(await model.apply(items, ["a"], { kind: "move", space: " " })).toBe(false);
		expect(request).not.toHaveBeenCalled();
	});
	it("never invents successes for missing results and exposes request errors", async () => {
		const { api } = client([]);
		const model = new BulkModel(api);
		await model.apply(items, ["a"], { kind: "delete" });
		expect(model.state.failures).toEqual([{ id: "a", message: "未收到这条记忆的处理结果。" }]);
		api.request = async () => {
			throw new Error("offline");
		};
		expect(await model.apply(items, ["a"], { kind: "delete" })).toBe(false);
		expect(model.state.error).toBe("请求失败，请稍后重试。");
	});
	it("blocks duplicate submission", async () => {
		let resolve!: (value: unknown) => void;
		const api = {
			request: vi.fn(
				() =>
					new Promise((done) => {
						resolve = done;
					}),
			),
		} as AdminClient;
		const model = new BulkModel(api);
		const pending = model.apply(items, ["a"], { kind: "delete" });
		expect(await model.apply(items, ["a"], { kind: "delete" })).toBe(false);
		resolve({ results: [{ ok: false, error: { code: "forbidden" } }] });
		await pending;
		expect(model.state.busy).toBe(false);
	});
});
