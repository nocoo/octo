import { describe, expect, it } from "vitest";
import { DEFAULT_FUSION, fuseChannels, fuseRrf, fuseWeighted } from "./fusion";

describe("fuseRrf", () => {
	it("applies channel weights", () => {
		const fused = fuseRrf([{ id: "a", rank: 1, rawScore: 1 }], [], {
			method: "rrf",
			k: 60,
			weights: { fts: 2, vector: 0 },
		});
		expect(fused.get("a")).toBeCloseTo(2 / 61);
	});

	it("combines ranks with k=60", () => {
		const fused = fuseRrf(
			[{ id: "a", rank: 1, rawScore: 1 }],
			[{ id: "b", rank: 1, rawScore: 0.9 }],
			DEFAULT_FUSION,
		);
		expect(fused.get("a")).toBeCloseTo(1 / 61);
		expect(fused.get("b")).toBeCloseTo(1 / 61);
	});

	it("sums both channels for the same id", () => {
		const fused = fuseRrf(
			[{ id: "a", rank: 1, rawScore: 1 }],
			[{ id: "a", rank: 2, rawScore: 0.8 }],
			DEFAULT_FUSION,
		);
		expect(fused.get("a")).toBeCloseTo(1 / 61 + 1 / 62);
	});
});

describe("fuseWeighted", () => {
	it("handles a single channel", () => {
		const fused = fuseWeighted([], [{ id: "v", rank: 1, rawScore: 0.4 }], {
			method: "weighted",
			k: 60,
			weights: { fts: 1, vector: 2 },
		});
		expect(fused.get("v")).toBeCloseTo(2);
	});

	it("min-max normalizes then weights", () => {
		const fused = fuseWeighted(
			[
				{ id: "a", rank: 1, rawScore: 10 },
				{ id: "b", rank: 2, rawScore: 20 },
			],
			[{ id: "a", rank: 1, rawScore: 0.2 }],
			{ method: "weighted", k: 60, weights: { fts: 1, vector: 2 } },
		);
		expect(fused.get("b")).toBeCloseTo(1);
		expect(fused.get("a")).toBeCloseTo(2);
	});
});

describe("fuseChannels", () => {
	it("dispatches by method", () => {
		const rows = [{ id: "x", rank: 1, rawScore: 1 }];
		expect(fuseChannels(rows, [], { ...DEFAULT_FUSION, method: "rrf" }).get("x")).toBeDefined();
		expect(
			fuseChannels(rows, [], { ...DEFAULT_FUSION, method: "weighted" }).get("x"),
		).toBeDefined();
	});
});
