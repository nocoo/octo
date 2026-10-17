import type { SearchRequest } from "../../lib/schema/search";
import type { Env } from "../env";
import { d1Results } from "../lib/d1";
import { ApiError } from "../lib/errors";
import { buildVectorMetadataFilter } from "../ports/vector/filter";
import type { VectorStore } from "../ports/vector/types";
import type { AuthzContext } from "./authz";
import { intersectRequestedSpaces } from "./authz";
import { buildMemoryFilterSql, resolveMemoryFilterSql, type SqlFilter } from "./filters-sql";
import { runFtsChannel } from "./fts-channel";
import { DEFAULT_FUSION, fuseChannels, type RankedChannel } from "./fusion";
import { inferSearchMode } from "./infer-mode";
import { minMaxNormalize } from "./math";
import { loadMemoriesByIds, loadSpaceSlugMap, type MemoryRow, memoryToApi } from "./memory-read";
import { channelScore } from "./scores";
import { highlightSnippet } from "./snippet";
import { sqlInClause } from "./sql-in";
import { tokenizeQuery } from "./tokenizer";
import { createSearchVectorStore } from "./vector-store-factory";
import { assertVectorValues, loadEmbeddingProfile } from "./vector-write";

export type SearchDeps = {
	db: D1Database;
	env?: Env;
	vectorStore?: VectorStore;
};

function bm25ToNormalized(hits: Array<{ id: string; bm25: number }>): Map<string, number> {
	const scores = new Map(hits.map((h) => [h.id, -h.bm25]));
	return minMaxNormalize(scores);
}

export async function revalidateVectorHits(
	db: D1Database,
	hits: Array<{ id: string; score: number }>,
	filter: SqlFilter,
): Promise<Array<{ id: string; score: number }>> {
	if (!hits.length) return [];
	const ids = sqlInClause(
		"m.id",
		hits.map((hit) => hit.id),
	);
	const rows = await db
		.prepare(`SELECT m.id FROM memories m WHERE ${[...filter.clauses, ids.sql].join(" AND ")}`)
		.bind(...filter.binds, ...ids.binds)
		.all<{ id: string }>();
	const allowed = new Set(d1Results(rows).map((row) => row.id));
	return hits.filter((hit) => allowed.has(hit.id));
}

function normalizeQueryVector(
	db: D1Database,
	vector: NonNullable<SearchRequest["vector"]>,
): Promise<number[]> {
	return loadEmbeddingProfile(db, vector.profile).then((profile) => {
		if (!profile) {
			throw new ApiError("validation_failed", "unknown embedding profile");
		}
		try {
			return assertVectorValues(vector.values, profile.dims);
		} catch (err) {
			const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
			if (code === "vector_dimension_mismatch") {
				throw new ApiError("vector_dimension_mismatch", "vector dimension mismatch");
			}
			throw new ApiError(
				"validation_failed",
				err instanceof Error ? err.message : "invalid vector",
			);
		}
	});
}

export async function searchMemories(authz: AuthzContext, req: SearchRequest, deps: SearchDeps) {
	const limit = req.limit ?? 20;
	const candidateK = Math.min(100, limit * 5);
	const fusion = {
		...DEFAULT_FUSION,
		...req.fusion,
		weights: { ...DEFAULT_FUSION.weights, ...req.fusion?.weights },
		k: req.fusion?.k ?? DEFAULT_FUSION.k,
		method: req.fusion?.method ?? DEFAULT_FUSION.method,
	};
	const mode = inferSearchMode(req);
	const spaceMap = await loadSpaceSlugMap(deps.db);
	const spaceIds = intersectRequestedSpaces(authz, req.filters?.spaces, spaceMap);
	const spaceSlugs = spaceIds
		.map((id) => spaceMap.get(id))
		.filter((slug): slug is string => slug !== undefined);

	let ftsHits: Array<{ id: string; bm25: number }> = [];
	let ftsPartial = false;
	if (mode !== "vector" && req.query) {
		const fts = await runFtsChannel(deps.db, req.query, spaceIds, req.filters, candidateK);
		ftsHits = fts.hits;
		ftsPartial = fts.partial;
	}

	const contentFilter = await resolveMemoryFilterSql(deps.db, req.filters, spaceIds);
	let vectorHits: Array<{ id: string; score: number }> = [];
	let vectorTruncated = false;
	const profile = req.vector?.profile ?? "te3-small-1536";
	const queryVector =
		mode !== "fts" && req.vector ? await normalizeQueryVector(deps.db, req.vector) : undefined;
	if (queryVector && spaceIds.length > 0) {
		const filter = buildVectorMetadataFilter(req.filters, spaceSlugs);
		const sqlFilter = buildMemoryFilterSql(req.filters, spaceIds);
		const store =
			deps.vectorStore ??
			createSearchVectorStore(
				deps.env ?? { DB: deps.db, FILES: {} as R2Bucket, ASSETS: {} as Fetcher },
				deps.db,
				profile,
				sqlFilter,
			);
		const raw = await store.query({
			vector: queryVector,
			topK: candidateK,
			filter,
			returnMetadata: false,
		});
		vectorTruncated =
			Boolean(req.filters?.tags_all?.length || req.filters?.tags_any?.length) &&
			raw.length >= candidateK;
		vectorHits = await revalidateVectorHits(deps.db, raw, contentFilter);
	}

	const ftsRanked: RankedChannel[] = ftsHits.map((h, i) => ({
		id: h.id,
		rank: i + 1,
		rawScore: -h.bm25,
	}));
	const vecRanked: RankedChannel[] = vectorHits.map((h, i) => ({
		id: h.id,
		rank: i + 1,
		rawScore: h.score,
	}));
	const fusedScores =
		mode === "fts"
			? new Map(ftsRanked.map((r) => [r.id, r.rawScore]))
			: mode === "vector"
				? new Map(vecRanked.map((r) => [r.id, r.rawScore]))
				: fuseChannels(ftsRanked, vecRanked, fusion);

	let ordered = [...fusedScores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
	const memories = await loadMemoriesByIds(deps.db, ordered, contentFilter);
	ftsHits = ftsHits.filter((hit) => memories.has(hit.id));
	vectorHits = vectorHits.filter((hit) => memories.has(hit.id));
	ordered = ordered
		.filter((id) => memories.has(id))
		.sort((a, b) => {
			const fusedDiff = (fusedScores.get(b) ?? 0) - (fusedScores.get(a) ?? 0);
			if (fusedDiff !== 0) {
				return fusedDiff;
			}
			return (memories.get(b)?.updated_at ?? 0) - (memories.get(a)?.updated_at ?? 0);
		})
		.slice(0, limit);
	const ftsNorm = bm25ToNormalized(ftsHits);
	const vecNorm = minMaxNormalize(new Map(vectorHits.map((h) => [h.id, h.score])));
	const terms = req.query
		? [...tokenizeQuery(req.query).longTerms, ...tokenizeQuery(req.query).shortTerms]
		: [];

	const items = ordered.map((id) => {
		const row = memories.get(id) as MemoryRow;
		const ftsRank = ftsRanked.find((r) => r.id === id);
		const vecRank = vecRanked.find((r) => r.id === id);
		const item = {
			...memoryToApi(row),
			scores: {
				fused: fusedScores.get(id) ?? 0,
				fts: channelScore(
					ftsRank,
					ftsHits.find((h) => h.id === id)?.bm25,
					ftsNorm.get(id) ?? 0,
					"fts",
				),
				vector: channelScore(
					vecRank,
					vectorHits.find((h) => h.id === id)?.score,
					vecNorm.get(id) ?? 0,
					"vector",
				),
			},
		};
		return req.include?.includes("snippet")
			? { ...item, snippet: highlightSnippet(row.body, terms) }
			: item;
	});

	return {
		items,
		channels: {
			fts: { candidates: ftsHits.length, partial: ftsPartial },
			vector: {
				candidates: vectorHits.length,
				truncated: vectorTruncated,
				profile: req.vector ? profile : null,
			},
		},
	};
}
