import { describe, expect, it } from "vitest";
import { channelScore } from "./scores";

describe("channelScore", () => {
	it("returns null without a rank", () => {
		expect(channelScore(undefined, 1, 0.5, "fts")).toBeNull();
	});

	it("builds fts and vector score payloads", () => {
		const rank = { id: "m1", rank: 2, rawScore: 1 };
		expect(channelScore(rank, -3, 0.8, "fts")).toEqual({
			rank: 2,
			bm25: -3,
			normalized: 0.8,
		});
		expect(channelScore(rank, undefined, 0.5, "fts")).toEqual({
			rank: 2,
			bm25: null,
			normalized: 0.5,
		});
		expect(channelScore(rank, 0.7, 0.4, "vector")).toEqual({
			rank: 2,
			similarity: 0.7,
			normalized: 0.4,
		});
		expect(channelScore(rank, undefined, 0.4, "vector")).toEqual({
			rank: 2,
			similarity: null,
			normalized: 0.4,
		});
	});
});
