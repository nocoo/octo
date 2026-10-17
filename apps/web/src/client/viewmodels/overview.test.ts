import { describe, expect, it } from "vitest";
import type { AdminClient } from "../lib/api";
import { activitySeries, OverviewModel } from "./overview";

describe("overview aggregation", () => {
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
	it("loads existing snapshots, retains old data on refresh errors", async () => {
		let fail = false;
		const client = {
			request: async (path: string) => {
				if (fail) throw new Error("failed");
				if (path === "/spaces") return { items: [{ memory_count: 5 }, { memory_count: 7 }] };
				if (path === "/usage") return { daily: [], health: { vector_backlog: 2 } };
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
		expect(model.state.error).toBe("无法刷新总览，请重试。");
		expect(model.state.loading).toBe(false);
	});
});
