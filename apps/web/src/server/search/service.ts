import type { SearchRequest } from "../../lib/schema/search";
import { type Env, resourceEnv } from "../env";
import { d1Results } from "../lib/d1";
import { ApiError } from "../lib/errors";
import { buildVectorMetadataFilter } from "../ports/vector/filter";
import { capVectorTopK, type VectorStore } from "../ports/vector/types";
import { resolveSpaceSlug } from "../repo/spaces";
import type { AuthzContext } from "./authz";
import { intersectRequestedSpaces } from "./authz";
import { loadPendingVectorHits, revalidateCurrentVectorHits } from "./current-vector-hits";
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
	vectorStore?: Pick<VectorStore, "query">;
};

function bm25ToNormalized(hits: Array<{ id: string; bm25: number }>): Map<string, number> {
	const scores = new Map(hits.map((h) => [h.id, -h.bm25]));
	return minMaxNormalize(scores);
}

function uniqueChannelHits<T extends { id: string }>(hits: T[], score: (hit: T) => number): T[] {
	const unique = new Map<string, T>();
	for (const hit of hits) {
		const previous = unique.get(hit.id);
		if (!previous || score(hit) > score(previous)) unique.set(hit.id, hit);
	}
	return [...unique.values()].sort((a, b) => score(b) - score(a));
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
	const requested = req.filters?.spaces
		? await Promise.all(
				req.filters.spaces.map(
					async (slug) => (await resolveSpaceSlug(deps.db, slug))?.slug ?? slug,
				),
			)
		: undefined;
	const spaceIds = [...new Set(intersectRequestedSpaces(authz, requested, spaceMap))];
	const spaceSlugs = spaceIds
		.map((id) => spaceMap.get(id))
		.filter((slug): slug is string => slug !== undefined);

	let ftsHits: Array<{ id: string; bm25: number }> = [];
	if (mode !== "vector" && req.query) {
		const fts = await runFtsChannel(deps.db, req.query, spaceIds, req.filters, candidateK);
		ftsHits = fts.hits;
	}

	const contentFilter = await resolveMemoryFilterSql(deps.db, req.filters, spaceIds);
	let vectorHits: Array<{ id: string; score: number }> = [];
	let vectorTruncated = false;
	const profile = req.vector?.profile ?? "te3-small-1536";
	const queryVector =
		mode !== "fts" && req.vector ? await normalizeQueryVector(deps.db, req.vector) : undefined;
	if (queryVector && spaceIds.length > 0) {
		const production =
			deps.env !== undefined && resourceEnv(deps.env.RESOURCE_ENV) === "production";
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
			returnMetadata: production,
		});
		const validated = production
			? await revalidateCurrentVectorHits(deps.db, raw, sqlFilter, profile, queryVector)
			: await revalidateVectorHits(deps.db, raw, sqlFilter);
		const eligible = uniqueChannelHits(
			validated.filter((hit) => hit.score > 0),
			(hit) => hit.score,
		);
		const filtered = await revalidateVectorHits(deps.db, eligible, contentFilter);
		vectorHits = [...filtered];
		if (production) {
			vectorHits.push(
				...(await loadPendingVectorHits(deps.db, contentFilter, profile, queryVector, candidateK)),
			);
		}
		vectorHits = uniqueChannelHits(
			vectorHits.filter((hit) => hit.score > 0),
			(hit) => hit.score,
		).slice(0, candidateK);
		vectorTruncated =
			Boolean(req.filters?.tags_all?.length || req.filters?.tags_any?.length) &&
			eligible.length >= capVectorTopK(candidateK, production) &&
			filtered.length < eligible.length &&
			vectorHits.length < candidateK;
	}
	ftsHits = uniqueChannelHits(ftsHits, (hit) => -hit.bm25).slice(0, candidateK);

	const candidateIds = [...new Set([...ftsHits, ...vectorHits].map((hit) => hit.id))];
	const memories = await loadMemoriesByIds(deps.db, candidateIds, contentFilter);
	ftsHits = ftsHits.filter((hit) => memories.has(hit.id));
	if (vectorHits.length && !vectorHits.some((hit) => memories.has(hit.id))) vectorTruncated = false;
	vectorHits = vectorHits.filter((hit) => memories.has(hit.id));
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

	const ordered = [...fusedScores.keys()]
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
	const terms = req.query ? tokenizeQuery(req.query) : [];

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
			fts: {
				candidates: ftsHits.length,
				partial: false,
				partial_reason: null,
			},
			vector: {
				candidates: vectorHits.length,
				truncated: vectorTruncated,
				profile: req.vector ? profile : null,
			},
		},
	};
}
