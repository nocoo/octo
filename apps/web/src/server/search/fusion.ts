import { minMaxNormalize } from "./math";

export type FusionMethod = "rrf" | "weighted";

export type FusionConfig = {
	method: FusionMethod;
	k: number;
	weights: { fts: number; vector: number };
};

export const DEFAULT_FUSION: FusionConfig = {
	method: "rrf",
	k: 60,
	weights: { fts: 1, vector: 1 },
};

export type RankedChannel = {
	id: string;
	rank: number;
	rawScore: number;
};

export function fuseRrf(
	fts: RankedChannel[],
	vector: RankedChannel[],
	config: FusionConfig,
): Map<string, number> {
	const scores = new Map<string, number>();
	const add = (rows: RankedChannel[], weight: number) => {
		for (const row of rows) {
			const inc = weight / (config.k + row.rank);
			scores.set(row.id, (scores.get(row.id) ?? 0) + inc);
		}
	};
	add(fts, config.weights.fts);
	add(vector, config.weights.vector);
	return scores;
}

export function fuseWeighted(
	fts: RankedChannel[],
	vector: RankedChannel[],
	config: FusionConfig,
): Map<string, number> {
	const ftsScores = new Map(fts.map((r) => [r.id, r.rawScore]));
	const vecScores = new Map(vector.map((r) => [r.id, r.rawScore]));
	const ftsNorm = minMaxNormalize(ftsScores);
	const vecNorm = minMaxNormalize(vecScores);
	const ids = new Set([...ftsNorm.keys(), ...vecNorm.keys()]);
	const out = new Map<string, number>();
	for (const id of ids) {
		const f = ftsNorm.get(id) ?? 0;
		const v = vecNorm.get(id) ?? 0;
		out.set(id, config.weights.fts * f + config.weights.vector * v);
	}
	return out;
}

export function fuseChannels(
	fts: RankedChannel[],
	vector: RankedChannel[],
	config: FusionConfig,
): Map<string, number> {
	if (config.method === "weighted") {
		return fuseWeighted(fts, vector, config);
	}
	return fuseRrf(fts, vector, config);
}
