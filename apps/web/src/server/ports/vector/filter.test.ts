import { describe, expect, it } from "vitest";
import { buildVectorMetadataFilter } from "./filter";

describe("buildVectorMetadataFilter", () => {
	it("returns a single metadata clause for one space", () => {
		expect(buildVectorMetadataFilter(undefined, ["kb"])).toEqual({ space: { $in: ["kb"] } });
	});

	it("merges fields into one filter object", () => {
		expect(buildVectorMetadataFilter({ types: ["note"] }, ["kb"])).toEqual({
			space: { $in: ["kb"] },
			type: { $in: ["note"] },
		});
	});

	it("returns undefined when empty", () => {
		expect(buildVectorMetadataFilter(undefined, [])).toBeUndefined();
		expect(buildVectorMetadataFilter({}, [])).toBeUndefined();
		expect(buildVectorMetadataFilter({ time: { field: "updated" } }, [])).toBeUndefined();
	});

	it("returns a single clause without space when only types apply", () => {
		expect(buildVectorMetadataFilter({ types: ["note"] }, [])).toEqual({
			type: { $in: ["note"] },
		});
	});

	it("maps partial time ranges", () => {
		const result = buildVectorMetadataFilter(
			{ time: { field: "updated", from: "2026-01-01T00:00:00Z" } },
			["kb"],
		);
		expect(result).toEqual({
			space: { $in: ["kb"] },
			updated: { $gte: Date.parse("2026-01-01T00:00:00Z") },
		});
	});

	it("maps importance min only", () => {
		expect(buildVectorMetadataFilter({ importance: { min: 0.1 } }, [])).toEqual({
			importance: { $gte: 0.1 },
		});
	});

	it("maps importance max only", () => {
		expect(buildVectorMetadataFilter({ importance: { max: 0.5 } }, ["kb"])).toEqual({
			space: { $in: ["kb"] },
			importance: { $lte: 0.5 },
		});
	});

	it("merges importance min and max on one field", () => {
		const result = buildVectorMetadataFilter(
			{
				importance: { min: 0.2, max: 0.9 },
				time: { field: "created", from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
				sources: ["key1"],
			},
			["kb"],
		);
		expect(result).toEqual({
			space: { $in: ["kb"] },
			source: { $in: ["key1"] },
			importance: { $gte: 0.2, $lte: 0.9 },
			created: {
				$gte: Date.parse("2026-01-01T00:00:00Z"),
				$lte: Date.parse("2026-02-01T00:00:00Z"),
			},
		});
	});
});
