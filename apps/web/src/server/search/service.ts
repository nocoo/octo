import type { SearchRequest } from "../../lib/schema/search";
import { d1Results } from "../lib/d1";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { buildVectorMetadataFilter } from "../ports/vector/filter";
import type { VectorStore } from "../ports/vector/types";
import type { AuthzContext } from "./authz";
import { intersectRequestedSpaces } from "./authz";
import { buildMemoryFilterSql } from "./filters-sql";
import { runFtsChannel } from "./fts-channel";
import { DEFAULT_FUSION, fuseChannels, type RankedChannel } from "./fusion";
import { inferSearchMode } from "./infer-mode";
import { minMaxNormalize } from "./math";
import {
	loadMemoriesByIds,
	loadSpaceSlugMap,
	loadTagsForMemories,
	type MemoryRow,
	memoryToApi,
} from "./memory-read";
import { channelScore } from "./scores";
import { highlightSnippet } from "./snippet";
import { resolveCanonicalTagIds } from "./tag-resolve";
import { tokenizeQuery } from "./tokenizer";

export type SearchDeps = {
	db: D1Database;
	vectorStore?: VectorStore;
};

function bm25ToNormalized(hits: Array<{ id: string; bm25: number }>): Map<string, number> {
	const scores = new Map(hits.map((h) => [h.id, -h.bm25]));
	return minMaxNormalize(scores);
}

export async function memoryPassesTagFilters(
	db: D1Database,
	memoryId: string,
	filters: SearchRequest["filters"],
): Promise<boolean> {
	if (!filters?.tags_all?.length && !filters?.tags_any?.length) {
		return true;
	}
	const rows = await db
		.prepare(
			`SELECT t.id, t.name FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.memory_id = ?`,
		)
		.bind(memoryId)
		.all<{ id: string; name: string }>();
	const have = new Set(d1Results(rows).map((r) => r.id));
	if (filters.tags_all?.length) {
		const need = await resolveCanonicalTagIds(db, filters.tags_all);
		if (!need.every((id) => have.has(id))) {
			return false;
		}
	}
	if (filters.tags_any?.length) {
		const any = await resolveCanonicalTagIds(db, filters.tags_any);
		if (!any.some((id) => have.has(id))) {
			return false;
		}
	}
	return true;
}

export async function revalidateVectorHits(
	db: D1Database,
	hits: Array<{ id: string; score: number }>,
	spaceIds: string[],
	filters: SearchRequest["filters"],
): Promise<Array<{ id: string; score: number }>> {
	const out: Array<{ id: string; score: number }> = [];
	for (const hit of hits) {
		const base = buildMemoryFilterSql(filters, spaceIds);
		const clauses = [...base.clauses, "m.id = ?"];
		const row = await db
			.prepare(`SELECT m.id FROM memories m WHERE ${clauses.join(" AND ")} LIMIT 1`)
			.bind(...base.binds, hit.id)
			.first<{ id: string }>();
		if (!row) {
			continue;
		}
		if (!(await memoryPassesTagFilters(db, hit.id, filters))) {
			continue;
		}
		out.push(hit);
	}
	return out;
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

	let vectorHits: Array<{ id: string; score: number }> = [];
	let vectorTruncated = false;
	const profile = req.vector?.profile ?? "te3-small-1536";
	if (mode !== "fts" && req.vector) {
		const filter = buildVectorMetadataFilter(req.filters, spaceSlugs);
		const store =
			deps.vectorStore ??
			new D1BruteForceVectorStore(deps.db, profile, buildMemoryFilterSql(req.filters, spaceIds));
		const raw = await store.query({
			vector: req.vector.values,
			topK: candidateK,
			filter,
			returnMetadata: false,
		});
		vectorTruncated =
			Boolean(req.filters?.tags_all?.length || req.filters?.tags_any?.length) &&
			raw.length >= candidateK;
		vectorHits = await revalidateVectorHits(deps.db, raw, spaceIds, req.filters);
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
	const memories = await loadMemoriesByIds(deps.db, ordered);
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
	const tags = await loadTagsForMemories(deps.db, ordered);
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
			...memoryToApi(row, tags.get(id) ?? []),
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
