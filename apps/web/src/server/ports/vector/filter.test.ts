import { describe, expect, it } from "vitest";
import { buildVectorMetadataFilter } from "./filter";

describe("buildVectorMetadataFilter", () => {
	it("returns a single metadata clause for one space", () => {
		expect(buildVectorMetadataFilter(undefined, ["kb"])).toEqual({ space: { $in: ["kb"] } });
	});

	it("maps spaces and types", () => {
		expect(buildVectorMetadataFilter({ types: ["note"] }, ["kb"])).toEqual({
			$and: [{ space: { $in: ["kb"] } }, { type: { $in: ["note"] } }],
		});
	});

	it("returns undefined when empty", () => {
		expect(buildVectorMetadataFilter(undefined, [])).toBeUndefined();
		expect(buildVectorMetadataFilter({}, [])).toBeUndefined();
		expect(buildVectorMetadataFilter({ time: { field: "updated" } }, [])).toBeUndefined();
	});

	it("returns a single clause without $and when only one predicate applies", () => {
		expect(buildVectorMetadataFilter({ types: ["note"] }, [])).toEqual({
			type: { $in: ["note"] },
		});
	});

	it("maps partial time ranges", () => {
		const result = buildVectorMetadataFilter(
			{ time: { field: "updated", from: "2026-01-01T00:00:00Z" } },
			["kb"],
		);
		expect(result?.$and).toEqual(
			expect.arrayContaining([
				{ space: { $in: ["kb"] } },
				{ updated: { $gte: Date.parse("2026-01-01T00:00:00Z") } },
			]),
		);
	});

	it("maps time and importance ranges", () => {
		const result = buildVectorMetadataFilter(
			{
				importance: { min: 0.2, max: 0.9 },
				time: { field: "created", from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
				sources: ["key1"],
			},
			["kb"],
		);
		expect(result).toMatchObject({
			$and: expect.arrayContaining([
				{ space: { $in: ["kb"] } },
				{ source: { $in: ["key1"] } },
				{ importance: { $gte: 0.2 } },
				{ importance: { $lte: 0.9 } },
				{
					created: {
						$gte: Date.parse("2026-01-01T00:00:00Z"),
						$lte: Date.parse("2026-02-01T00:00:00Z"),
					},
				},
			]),
		});
	});
});
