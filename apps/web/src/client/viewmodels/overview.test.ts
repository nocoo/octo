import { describe, expect, it, vi } from "vitest";
import { type AdminClient, ApiError } from "../lib/api";
import {
	actorId,
	botCalls,
	botDetail,
	botName,
	botOperations,
	bucketOf,
	type DashboardPayload,
	dailySeries,
	OverviewModel,
	operationTotals,
	parseOverviewRange,
	rangeWindow,
	spaceDetail,
	spaceDistribution,
	spaceOperations,
	summary,
	topBots,
	topSpaces,
	typeDistribution,
} from "./overview";

function payload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
	return {
		range: { from: "2026-10-16", to: "2026-10-18", days: 3 },
		totals: { memories: 5, trash: 2, spaces: 2, keys: 2 },
		ops: [
			{ day: "2026-10-16", actor: "key:K1", space_id: "s1", op: "created", count: 2 },
			{ day: "2026-10-16", actor: "key:K1", space_id: "s1", op: "updated", count: 1 },
			{ day: "2026-10-17", actor: "key:K2", space_id: "s2", op: "moved_out", count: 3 },
			{ day: "2026-10-17", actor: "admin:a@b.c", space_id: "s2", op: "trashed", count: 1 },
			{ day: "2026-10-18", actor: "key:K1", space_id: "s2", op: "purged", count: 2 },
			{ day: "2026-10-18", actor: "key:K1", space_id: "s1", op: "tag_merged", count: 9 },
		],
		usage: [
			{ day: "2026-10-16", key_id: "K1", calls: 10, errors: 1, writes: 4 },
			{ day: "2026-10-17", key_id: "K2", calls: 40, errors: 0, writes: 2 },
			{ day: "2026-10-18", key_id: "K1", calls: 20, errors: 3, writes: 1 },
		],
		types: [
			{ space_id: "s1", type: "fact", count: 3 },
			{ space_id: "s2", type: "note", count: 2 },
		],
		spaces: [
			{ id: "s1", slug: "kb", name: "知识库", memories: 3, trash: 1 },
			{ id: "s2", slug: "notes", name: "笔记", memories: 2, trash: 1 },
		],
		keys: [
			{ id: "K1", name: "采集助手", role: "project", revoked: false, last_used_at: null },
			{ id: "K2", name: "整理助手", role: "drop", revoked: true, last_used_at: null },
		],
		...overrides,
	};
}

describe("overview daily series", () => {
	it("zero-fills every UTC day and buckets operations by type", () => {
		const rows = dailySeries(payload());
		expect(rows.map((row) => row.x)).toEqual(["2026-10-16", "2026-10-17", "2026-10-18"]);
		expect(rows[0]).toMatchObject({ created: 2, updated: 1, moved: 0, net: 2 });
		expect(rows[1]).toMatchObject({ moved: 3, trashed: 1, net: 0 });
		expect(rows[2]).toMatchObject({ purged: 2, net: -2 });
		expect(rows[0]).toMatchObject({ calls: 10, errors: 1, writes: 4 });
		expect(rows[0]?.errorRate).toBeCloseTo(0.1);
		expect(rows[1]?.errorRate).toBe(0);
		expect(
			dailySeries(payload({ range: { from: "2026-10-16", to: "2026-10-16", days: 1 } })),
		).toHaveLength(1);
	});

	it("maps only known memory operations and ignores derived tag events", () => {
		expect(bucketOf("moved_out")).toBe("moved");
		expect(bucketOf("rolled_back")).toBe("rolled_back");
		expect(bucketOf("tag_merged")).toBeNull();
		expect(bucketOf("unknown")).toBeNull();
		expect(dailySeries(payload()).reduce((sum, row) => sum + row.updated, 0)).toBe(1);
	});

	it("leaves the error rate undefined without calls and totals operations by bucket", () => {
		const rows = dailySeries(payload({ usage: [] }));
		expect(rows[0]?.errorRate).toBeNull();
		expect(operationTotals(rows)).toEqual([
			{ key: "created", name: "创建", value: 2 },
			{ key: "updated", name: "更新", value: 1 },
			{ key: "moved", name: "移动", value: 3 },
			{ key: "trashed", name: "回收站", value: 1 },
			{ key: "purged", name: "永久删除", value: 2 },
		]);
	});
});

describe("overview identity helpers", () => {
	it("maps actors to bots and prefers configured names", () => {
		expect(actorId("key:K1")).toBe("K1");
		expect(actorId("admin:a@b.c")).toBe("admin");
		expect(botName("K1", payload().keys)).toBe("采集助手");
		expect(botName("admin", payload().keys)).toBe("控制台");
		expect(botName("K9", payload().keys)).toBe("K9");
	});

	it("assigns one distinct colour slot per stacked series", () => {
		const chart = spaceOperations(payload(), 1);
		expect(chart.series.map((series) => series.colorIndex)).toEqual([0, -1]);
		expect(botOperations(payload()).series.map((series) => series.colorIndex)).toEqual([0, 1, 2]);
		expect(spaceOperations(payload({ ops: [...payload().ops].reverse() }), 1).series).toEqual(
			chart.series,
		);
	});
});

describe("overview stacked charts", () => {
	it("stacks the busiest spaces and aggregates the tail per day", () => {
		const chart = spaceOperations(payload(), 1);
		expect(chart.series.map((series) => series.label)).toEqual(["笔记", "其他 1 项"]);
		expect(chart.rows).toEqual([
			{ x: "2026-10-16", s0: 0, s1: 3 },
			{ x: "2026-10-17", s0: 4, s1: 0 },
			{ x: "2026-10-18", s0: 2, s1: 0 },
		]);
	});

	it("stacks operations and calls per bot with the console actor", () => {
		expect(botOperations(payload()).series.map((series) => series.label)).toEqual([
			"采集助手",
			"整理助手",
			"控制台",
		]);
		expect(botCalls(payload()).rows[1]).toEqual({ x: "2026-10-17", s0: 40, s1: 0 });
		expect(botOperations(payload({ keys: [] })).series[0]?.label).toBe("K1");
		expect(botCalls(payload({ usage: [] })).series).toEqual([]);
	});

	it("renders empty charts without a tail series", () => {
		const empty = spaceOperations(payload({ ops: [] }));
		expect(empty.series).toEqual([]);
		expect(empty.rows.map((row) => row.x)).toHaveLength(3);
	});
});

describe("overview distributions", () => {
	it("labels memory types in Chinese and sorts by count", () => {
		expect(typeDistribution(payload())).toEqual([
			{ key: "fact", name: "事实", value: 3 },
			{ key: "note", name: "笔记", value: 2 },
		]);
		expect(
			typeDistribution(payload({ types: [{ space_id: "s1", type: "custom", count: 1 }] })),
		).toEqual([{ key: "custom", name: "custom", value: 1 }]);
	});

	it("groups the space tail into one slice", () => {
		expect(spaceDistribution(payload(), 1)).toEqual([
			{ key: "s1", name: "知识库", value: 3 },
			{ key: "other", name: "其他 1 个空间", value: 2 },
		]);
		expect(spaceDistribution(payload({ spaces: [] }))).toEqual([]);
	});
});

describe("overview summary", () => {
	it("counts operations, calls, active bots and the daily average", () => {
		const data = payload();
		expect(summary(data, dailySeries(data))).toEqual({
			memories: 5,
			trash: 2,
			spaces: 2,
			bots: 2,
			activeBots: 2,
			ops: 9,
			net: 0,
			calls: 70,
			errors: 4,
			errorRate: 4 / 70,
			dailyOps: 3,
		});
	});
});

describe("overview rankings", () => {
	it("ranks bots by calls with shares, error rates and sparklines", () => {
		const rows = topBots(payload());
		expect(rows.map((row) => row.name)).toEqual(["整理助手", "采集助手"]);
		expect(rows[0]).toMatchObject({ calls: 40, ops: 3, revoked: true, share: 40 / 70 });
		expect(rows[1]).toMatchObject({ calls: 30, ops: 5 });
		expect(rows[1]?.errorRate).toBeCloseTo(4 / 30);
		expect(rows[1]?.sparkline.map((point) => point.value)).toEqual([3, 0, 2]);
		expect(topBots(payload({ keys: [] }))).toEqual([]);
	});

	it("ranks spaces by operations and exposes the memory share", () => {
		expect(topSpaces(payload())).toEqual([
			expect.objectContaining({ name: "笔记", ops: 6, memories: 2, share: 2 / 5 }),
			expect.objectContaining({ name: "知识库", ops: 3, memories: 3, share: 3 / 5 }),
		]);
		expect(topSpaces(payload(), 1)).toHaveLength(1);
	});
});

describe("overview detail panels", () => {
	it("scopes bot operations, calls and spaces", () => {
		const detail = botDetail(payload(), "K1");
		expect(detail.bot?.name).toBe("采集助手");
		expect(detail.totals).toMatchObject({ ops: 5, calls: 30, errors: 4, writes: 5 });
		expect(detail.spaces).toEqual([
			{ id: "s1", name: "知识库", ops: 3, memories: 3 },
			{ id: "s2", name: "笔记", ops: 2, memories: 2 },
		]);
		expect(botDetail(payload(), "missing").bot).toBeNull();
	});

	it("scopes a space's operations, types and bots", () => {
		const detail = spaceDetail(payload(), "s1");
		expect(detail.space?.name).toBe("知识库");
		expect(detail.totals).toEqual({ ops: 3, net: 2, memories: 3, trash: 1 });
		expect(detail.types).toEqual([{ key: "fact", name: "事实", value: 3 }]);
		expect(detail.bots).toEqual([{ id: "K1", name: "采集助手", ops: 3 }]);
		expect(spaceDetail(payload(), "missing").space).toBeNull();
		const orphan = spaceDetail(
			payload({
				ops: [
					{ day: "2026-10-16", actor: "key:K2", space_id: "s9", op: "created", count: 1 },
					{ day: "2026-10-16", actor: "key:K1", space_id: "s9", op: "created", count: 1 },
				],
				types: [
					{ space_id: "s9", type: "custom", count: 2 },
					{ space_id: "s9", type: "fact", count: 2 },
				],
			}),
			"s9",
		);
		expect(orphan.space).toBeNull();
		expect(orphan.types).toEqual([
			{ key: "custom", name: "custom", value: 2 },
			{ key: "fact", name: "事实", value: 2 },
		]);
		expect(orphan.bots.map((bot) => bot.name)).toEqual(["整理助手", "采集助手"]);
		expect(orphan.totals).toMatchObject({ memories: 0, trash: 0, ops: 2 });
	});
});

describe("overview range", () => {
	it("accepts only supported ranges from the URL", () => {
		expect(parseOverviewRange(new URLSearchParams("range=7"))).toBe(7);
		expect(parseOverviewRange(new URLSearchParams("range=90"))).toBe(90);
		expect(parseOverviewRange(new URLSearchParams("range=13"))).toBe(30);
		expect(parseOverviewRange(new URLSearchParams(""))).toBe(30);
	});

	it("builds an inclusive UTC window ending today", () => {
		const now = Date.parse("2026-10-19T23:30:00.000Z");
		expect(rangeWindow(7, now)).toEqual({ from: "2026-10-13", to: "2026-10-19" });
		expect(rangeWindow(90, now)).toEqual({ from: "2026-07-22", to: "2026-10-19" });
	});
});

describe("OverviewModel", () => {
	it("loads the dashboard for the selected window", async () => {
		const request = vi.fn(async () => payload());
		const model = new OverviewModel({ request } as unknown as AdminClient, () =>
			Date.parse("2026-10-18T06:00:00.000Z"),
		);
		await model.load(7);
		expect(request).toHaveBeenCalledWith("/dashboard?from=2026-10-12&to=2026-10-18");
		expect(model.state.data?.totals.memories).toBe(5);
		expect(model.state.loading).toBe(false);
	});

	it("explains known API failures in Chinese without exposing service details", async () => {
		const model = new OverviewModel({
			request: async () => {
				throw new ApiError(403, "access_denied");
			},
		});
		await model.load(30);
		expect(model.state.error).toBe("无法刷新总览：没有访问权限，请重新登录或联系管理员。");
	});

	it("drops a stale response when the range changes while loading", async () => {
		const releases: (() => void)[] = [];
		const request = vi.fn(
			() =>
				new Promise((resolve) => {
					releases.push(() => resolve(payload()));
				}),
		);
		const model = new OverviewModel({ request } as unknown as AdminClient);
		const first = model.load(30);
		const second = model.load(7);
		expect(request).toHaveBeenCalledTimes(2);
		releases[1]?.();
		await second;
		const current = model.state.data;
		releases[0]?.();
		await first;
		expect(model.state.data).toBe(current);
		expect(model.state.loading).toBe(false);
	});
});
