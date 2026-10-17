import { describe, expect, it } from "vitest";
import { memoryFiltersSchema } from "./filters";

describe("memoryFiltersSchema", () => {
	it("accepts empty filters", () => {
		expect(memoryFiltersSchema.parse({})).toEqual({});
	});

	it("accepts documented filter fields", () => {
		const filters = {
			spaces: ["kb-bot"],
			tags_any: ["infra"],
			time: { field: "updated" as const, from: "2026-01-01T00:00:00Z" },
			importance: { min: 0.2, max: 0.9 },
		};
		expect(memoryFiltersSchema.parse(filters)).toEqual(filters);
	});

	it("rejects unknown fields", () => {
		expect(memoryFiltersSchema.safeParse({ unknown: true }).success).toBe(false);
	});

	it("requires Z timestamps on time filters", () => {
		expect(
			memoryFiltersSchema.safeParse({
				time: { field: "updated", from: "not-a-date", to: "yesterday" },
			}).success,
		).toBe(false);
		expect(
			memoryFiltersSchema.safeParse({
				time: { field: "created", from: "2026-01-01T00:00:00+08:00" },
			}).success,
		).toBe(false);
		expect(
			memoryFiltersSchema.safeParse({
				time: { field: "event", to: "2026-12-31T23:59:59.999Z" },
			}).success,
		).toBe(true);
	});
});
