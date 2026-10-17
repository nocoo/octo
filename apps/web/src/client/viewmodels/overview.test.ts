import { describe, expect, it, vi } from "vitest";
import { type AdminClient, ApiError } from "../lib/api";
import { activitySeries, OverviewModel } from "./overview";

describe("overview aggregation", () => {
	it("explains known API failures in Chinese without exposing arbitrary service details", async () => {
		const model = new OverviewModel({
			request: async () => {
				throw new ApiError(403, "access_denied");
			},
		});
		await model.load();
		expect(model.state.error).toBe("无法刷新总览：没有访问权限，请重新登录或联系管理员。");
	});
	it("aggregates stable key series and daily activity", () => {
		const daily = [
			{ day: "2026-10-17", key_id: "b", calls: 3 },
			{ day: "2026-10-16", key_id: "a", calls: 4 },
			{ day: "2026-10-17", key_id: "a", calls: 2 },
		];
		const result = activitySeries(daily);
		expect(result.keys).toEqual(["a", "b"]);
		expect(result.rows).toEqual([
			{ x: "2026-10-16", agent_0: 4, agent_1: 0 },
			{ x: "2026-10-17", agent_0: 2, agent_1: 3 },
		]);
		expect(result.heatmap).toEqual([
			{ date: "2026-10-16", value: 4 },
			{ date: "2026-10-17", value: 5 },
		]);
		expect(activitySeries([])).toEqual({ keys: [], colors: [], rows: [], heatmap: [] });
	});
	it("keeps chart colors stable as agents enter or leave the dataset", () => {
		const one = activitySeries([{ day: "2026-10-17", key_id: "b", calls: 3 }]);
		const many = activitySeries([
			{ day: "2026-10-17", key_id: "a", calls: 1 },
			{ day: "2026-10-17", key_id: "b", calls: 3 },
		]);
		expect(one.colors[0]).toBe(many.colors[1]);
	});
	it("keeps key identifiers separate from chart coordinate fields", () => {
		expect(activitySeries([{ day: "2026-10-17", key_id: "x", calls: 7 }]).rows).toEqual([
			{ x: "2026-10-17", agent_0: 7 },
		]);
	});
	it("fully paginates M7 rollups, trash and ascending changes before deriving exact metrics", async () => {
		const request = vi.fn(async (path: string) => {
			const url = new URL(path, "https://admin.invalid");
			const more = url.searchParams.has("cursor");
			switch (url.pathname) {
				case "/spaces":
					return { items: [{ memory_count: 5 }, { memory_count: 7 }], next_cursor: null };
				case "/usage":
					expect(url.searchParams.get("from")).toBe("2026-01-01");
					expect(url.searchParams.get("to")).toBe("2026-10-18");
					return {
						items: [
							{
								day: more ? "2026-10-18" : "2026-10-17",
								key_id: "k",
								calls: 3,
								errors: 0,
								writes: more ? 2 : 9,
								bytes_in: 20,
								bytes_out: 30,
							},
						],
						next_cursor: more ? null : "usage+page",
					};
				case "/trash":
					return {
						items: more ? [{ id: "t2" }, { id: "t3" }] : [{ id: "t1" }],
						next_cursor: more ? null : "trash/page",
					};
				case "/changes":
					return {
						items: more
							? [
									{
										seq: 20,
										entity: "memory",
										entity_id: "m20",
										op: "trashed",
										at: "2026-10-18T02:00:00.000Z",
									},
								]
							: Array.from({ length: 15 }, (_, index) => ({
									seq: index + 1,
									entity: "memory",
									entity_id: `m${index}`,
									op: "update",
									actor: "admin:owner@example.com",
									at: "2026-10-18T01:00:00.000Z",
									version: 2,
									space_id: "s1",
								})),
						next_cursor: more ? null : "changes=next",
					};
				default:
					return {
						items: [
							{
								id: "memory",
								title: "Note",
								space: "notes",
								tags: [],
								updated_at: "2026-10-17T00:00:00.000Z",
							},
						],
						next_cursor: null,
					};
			}
		});
		const model = new OverviewModel({ request } as AdminClient, () =>
			Date.parse("2026-10-18T00:30:00Z"),
		);
		await model.load();
		expect(model.state).toMatchObject({
			memoryCount: 12,
			trashCount: 3,
			writesToday: 2,
			activeKeysToday: 1,
			error: null,
		});
		expect(model.state.usage).toHaveLength(2);
		expect(model.state.changes).toHaveLength(12);
		expect(model.state.changes[0]).toMatchObject({ seq: 20, op: "trashed" });
		expect(model.state.changes[1]).toMatchObject({
			seq: 15,
			actor: "admin:owner@example.com",
			at: "2026-10-18T01:00:00.000Z",
		});
		expect(request).toHaveBeenCalledWith(
			"/usage?from=2026-01-01&to=2026-10-18&limit=200&cursor=usage%2Bpage",
		);
		expect(request).toHaveBeenCalledWith("/trash?limit=200&cursor=trash%2Fpage");
		expect(request).toHaveBeenCalledWith("/changes?limit=200&cursor=changes%3Dnext");
		expect(request.mock.calls.every(([path]) => !path.includes("settings"))).toBe(true);
	});
	it.each(["/trash", "/usage"])(
		"never reports partial %s pages as complete counts",
		async (endpoint) => {
			const request = vi.fn(async (path: string) => {
				if (path.startsWith(endpoint)) return { items: [{ id: "t" }], next_cursor: "repeat" };
				return { items: [], next_cursor: null };
			});
			const model = new OverviewModel({ request } as AdminClient);
			await model.load();
			expect(model.state.trashCount).toBeNull();
			expect(model.state.writesToday).toBeNull();
			expect(model.state.error).toContain("分页游标重复");
		},
	);
	it("ignores overlapping refreshes and reports a genuine empty rollup as zero", async () => {
		let release!: (page: { items: []; next_cursor: null }) => void;
		const page = new Promise((resolve) => {
			release = resolve;
		});
		const request = vi.fn(() => page);
		const model = new OverviewModel({ request } as AdminClient);
		const pending = model.load();
		await model.load();
		expect(request).toHaveBeenCalledTimes(5);
		release({ items: [], next_cursor: null });
		await pending;
		expect(model.state).toMatchObject({
			memoryCount: 0,
			trashCount: 0,
			writesToday: 0,
			activeKeysToday: 0,
			loading: false,
			error: null,
		});
	});
	it("loads existing snapshots, retains old data on refresh errors", async () => {
		let fail = false;
		const client = {
			request: async (path: string) => {
				if (fail) throw new Error("failed");
				if (path === "/spaces")
					return { items: [{ memory_count: 5 }, { memory_count: 7 }], next_cursor: null };
				if (!path.startsWith("/memories")) return { items: [], next_cursor: null };
				return {
					items: [{ id: "memory", title: "Note", updated_at: "2026-10-17" }],
					next_cursor: null,
				};
			},
		} as AdminClient;
		const model = new OverviewModel(client);
		await model.load();
		expect(model.state.memoryCount).toBe(12);
		expect(model.state.recent).toHaveLength(1);
		expect(model.state.error).toBeNull();
		fail = true;
		await model.load();
		expect(model.state.memoryCount).toBe(12);
		expect(model.state.error).toBe("无法刷新总览：请求失败，请稍后重试。");
		expect(model.state.loading).toBe(false);
	});
});
