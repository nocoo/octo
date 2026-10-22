import { describe, expect, it, vi } from "vitest";
import {
	applyMemoryFilters,
	filterChoices,
	filterValues,
	MemoryFilterOptionsModel,
	memoryFilterChips,
	removeMemoryFilter,
} from "./memory-filters";

describe("memory filter presentation", () => {
	it("serializes multiselect drafts without losing search options or exact UTC timestamps", () => {
		const params = new URLSearchParams("q=tea&mode=fts&view=cards&limit=20&cursor=old&selected=m1");
		const form = new FormData();
		form.append("spaces", "garden");
		form.append("spaces", "studio");
		form.append("types", "note");
		form.append("types", "event");
		form.set("tags_all", "alpha,beta");
		form.set("tags_any", "gamma,delta");
		form.set("sources", "revoked-key");
		form.set("time_field", "event");
		form.set("time_from", "2026-10-01T00:00:00.001Z");
		form.set("importance_min", "0");
		const next = applyMemoryFilters(params, form);
		expect(next.get("spaces")).toBe("garden,studio");
		expect(next.get("types")).toBe("note,event");
		for (const name of [
			"tags_all",
			"tags_any",
			"sources",
			"time_field",
			"time_from",
			"importance_min",
		])
			expect(next.get(name)).toBe(form.get(name));
		for (const name of ["q", "mode", "view", "limit"])
			expect(next.get(name)).toBe(params.get(name));
		expect(next.has("cursor")).toBe(false);
		expect(next.has("selected")).toBe(false);
		expect(params.get("cursor")).toBe("old");
	});
	it("clears individual applied dimensions and normalizes orphaned time fields", () => {
		const params = new URLSearchParams(
			"spaces=garden&types=note&time_field=event&time_to=2026-10-01T00:00:00Z&cursor=old&selected=m1&q=tea",
		);
		const one = removeMemoryFilter(params, "spaces");
		expect(one.has("spaces")).toBe(false);
		expect(one.get("types")).toBe("note");
		expect(one.get("time_field")).toBe("event");
		expect(removeMemoryFilter(one, "time_to").has("time_field")).toBe(false);
		expect(removeMemoryFilter(params).toString()).toBe("q=tea");
		const form = new FormData();
		form.set("time_field", "event");
		expect(applyMemoryFilters(params, form).toString()).toBe("q=tea");
	});

	it("retains unknown selections and lets freeform choices survive missing metadata", () => {
		expect(filterValues(" garden, ,studio ")).toEqual(["garden", "studio"]);
		expect(filterValues(null)).toEqual([]);
		expect(
			filterChoices([{ value: "garden", label: "Garden" }], ["garden", "missing"], "new"),
		).toEqual([
			{ value: "garden", label: "Garden" },
			{ value: "missing", label: "missing" },
			{ value: "new", label: "new" },
		]);
		expect(filterChoices([], [], "a,b")).toEqual([]);
		expect(filterChoices([], [], " ")).toEqual([]);
		expect(filterChoices([{ value: "garden", label: "Garden name" }], [], "garden NAME")).toEqual([
			{ value: "garden", label: "Garden name" },
		]);
	});

	it("builds chips only from applied URL values without losing zero or unknown values", () => {
		const chips = memoryFilterChips(
			new URLSearchParams(
				"spaces=garden,missing&types=note,other&tags_all=a,b&time_field=event&importance_min=0",
			),
			[{ slug: "garden", name: "Garden" }],
		);
		expect(chips).toEqual([
			{ key: "spaces", label: "空间", value: "Garden、missing" },
			{ key: "tags_all", label: "包含全部标签", value: "a,b" },
			{ key: "types", label: "类型", value: "笔记、other" },
			{ key: "time_field", label: "时间字段", value: "事件时间" },
			{ key: "importance_min", label: "重要性下限", value: "0" },
		]);
		expect(memoryFilterChips(new URLSearchParams("time_field=unknown"), [])[0]?.value).toBe(
			"unknown",
		);
		expect(memoryFilterChips(new URLSearchParams(), [])).toEqual([]);
	});

	it("loads filter space options and offers a retry after metadata failure", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error("private upstream detail"))
			.mockResolvedValueOnce({ items: [{ slug: "garden", name: "Garden" }] });
		const model = new MemoryFilterOptionsModel({ request });
		await model.load();
		expect(model.state.loading).toBe(false);
		expect(model.state.error).toBe("空间选项加载失败，仍可输入标识筛选。");
		await model.load();
		expect(request).toHaveBeenCalledWith("/spaces");
		expect(model.state).toEqual({
			loading: false,
			error: null,
			spaces: [{ slug: "garden", name: "Garden" }],
		});
	});
});
