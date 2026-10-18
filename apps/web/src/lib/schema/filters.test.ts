import { describe, expect, it } from "vitest";
import { z } from "zod";
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

	it("validates and describes importance filter bounds as inclusive 0-1", () => {
		expect(memoryFiltersSchema.safeParse({ importance: { min: 0, max: 1 } }).success).toBe(true);
		for (const importance of [{ min: -0.01 }, { max: 1.01 }, { min: "0" }, { max: null }])
			expect(memoryFiltersSchema.safeParse({ importance }).success).toBe(false);
		expect(z.toJSONSchema(memoryFiltersSchema).properties?.importance).toMatchObject({
			properties: {
				min: { minimum: 0, maximum: 1, description: expect.stringContaining("0 to 1") },
				max: { minimum: 0, maximum: 1, description: expect.stringContaining("0 to 1") },
			},
		});
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
