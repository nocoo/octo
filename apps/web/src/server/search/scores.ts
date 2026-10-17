import type { RankedChannel } from "./fusion";

export type ChannelScore = {
	rank: number;
	bm25?: number | null;
	similarity?: number | null;
	normalized: number;
};

export function channelScore(
	rank: RankedChannel | undefined,
	raw: number | null | undefined,
	normalized: number,
	kind: "fts" | "vector",
): ChannelScore | null {
	if (!rank) {
		return null;
	}
	if (kind === "fts") {
		return { rank: rank.rank, bm25: raw ?? null, normalized };
	}
	return { rank: rank.rank, similarity: raw ?? null, normalized };
}
