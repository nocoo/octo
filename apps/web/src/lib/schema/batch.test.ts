import { describe, expect, it } from "vitest";
import { batchCreateBodySchema, batchUpdateBodySchema } from "./batch";

describe("batchCreateBodySchema", () => {
	it("accepts large item arrays for route-level limits", () => {
		const items = Array.from({ length: 101 }, () => ({
			space: "s",
			title: "t",
			body: "b",
			type: "note" as const,
			tags: [] as string[],
		}));
		expect(batchCreateBodySchema.safeParse({ items }).success).toBe(true);
	});
});

describe("batchUpdateBodySchema", () => {
	it("accepts flat and nested items and normalizes both to flat patches", () => {
		expect(
			batchUpdateBodySchema.parse({
				items: [
					{ id: "first", title: "flat", expected_version: 1 },
					{ id: "second", patch: { importance: 0, expected_version: 2 } },
				],
			}),
		).toEqual({
			items: [
				{ id: "first", title: "flat", expected_version: 1 },
				{ id: "second", importance: 0, expected_version: 2 },
			],
		});
	});

	it.each([
		{
			id: "id",
			title: "flat",
			expected_version: 1,
			patch: { body: "nested", expected_version: 1 },
		},
		{ id: "id", expected_version: 1, patch: { title: "nested" } },
		{ id: "id", title: "flat", patch: { expected_version: 1 } },
		{ id: "id", patch: { id: "other", title: "nested", expected_version: 1 } },
		{ id: "id", extra: true, patch: { title: "nested", expected_version: 1 } },
		{ id: "id", patch: { title: "nested", expected_version: 1, extra: true } },
		{ id: "id", title: "flat", expected_version: 1, extra: true },
		{ id: "id", title: "missing version" },
		{ id: "id", patch: { title: "missing version" } },
		{ id: "id", expected_version: 1 },
		{ id: "id", patch: { expected_version: 1 } },
		{ id: "id", title: "invalid version", expected_version: 0 },
		{ id: "id", patch: { title: "invalid version", expected_version: 1.5 } },
		{ id: "", title: "empty id", expected_version: 1 },
	])("rejects invalid or mixed update forms %j", (item) => {
		expect(batchUpdateBodySchema.safeParse({ items: [item] }).success).toBe(false);
	});
});
