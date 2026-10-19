import { d1Results } from "../lib/d1";
import type { VectorQueryHit } from "../ports/vector/types";
import type { SqlFilter } from "./filters-sql";
import { decodeFloat32Vector, dot, l2Normalize } from "./math";
import { sqlInClause } from "./sql-in";

const PAGE_SIZE = 100;

type CurrentVector = {
	id: string;
	dim: number;
	vector: ArrayBuffer;
	content_hash: string;
	generation: number;
};

function currentVectorSql(filter: SqlFilter): string {
	return `SELECT m.id, mv.dim, mv.vector, mv.content_hash, j.generation
FROM memories m
JOIN memory_vectors mv ON mv.memory_id = m.id
JOIN embedding_profiles p ON p.id = mv.profile_id
JOIN vector_sync_jobs j ON j.memory_id = m.id
WHERE mv.profile_id = ? AND p.active = 1
AND mv.embedding_model = p.model AND mv.dim = p.dims AND mv.dim = ?
AND mv.content_hash = m.content_hash
AND ${filter.clauses.join(" AND ")}`;
}

function scoreCurrentVector(row: CurrentVector, queryVector: number[]): VectorQueryHit {
	return {
		id: row.id,
		score: dot(queryVector, l2Normalize(decodeFloat32Vector(row.vector, row.dim))),
		generation: row.generation,
		content_hash: row.content_hash,
	};
}

export async function revalidateCurrentVectorHits(
	db: D1Database,
	hits: VectorQueryHit[],
	filter: SqlFilter,
	profileId: string,
	queryVector: number[],
): Promise<VectorQueryHit[]> {
	if (!hits.length) return [];
	const ids = sqlInClause("m.id", [...new Set(hits.map((hit) => hit.id))]);
	const result = await db
		.prepare(`${currentVectorSql(filter)} AND ${ids.sql}`)
		.bind(profileId, queryVector.length, ...filter.binds, ...ids.binds)
		.all<CurrentVector>();
	const current = new Map(d1Results(result).map((row) => [row.id, row]));
	const verified = new Map<string, VectorQueryHit>();
	for (const hit of hits) {
		const row = current.get(hit.id);
		if (!row || hit.generation !== row.generation || hit.content_hash !== row.content_hash)
			continue;
		const scored = scoreCurrentVector(row, queryVector);
		if (scored.score > 0) verified.set(scored.id, scored);
	}
	return [...verified.values()].sort((a, b) => b.score - a.score);
}

export async function loadPendingVectorHits(
	db: D1Database,
	filter: SqlFilter,
	profileId: string,
	queryVector: number[],
	topK: number,
): Promise<VectorQueryHit[]> {
	let cursor = "";
	let best: VectorQueryHit[] = [];
	for (;;) {
		const result = await db
			.prepare(`${currentVectorSql(filter)}
AND (j.visible_generation IS NULL OR j.visible_generation != j.generation)
AND m.id > ? ORDER BY m.id LIMIT ?`)
			.bind(profileId, queryVector.length, ...filter.binds, cursor, PAGE_SIZE)
			.all<CurrentVector>();
		const rows = d1Results(result);
		best = [...best, ...rows.map((row) => scoreCurrentVector(row, queryVector))]
			.filter((hit) => hit.score > 0)
			.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
			.slice(0, topK);
		if (rows.length < PAGE_SIZE) return best;
		cursor = (rows[rows.length - 1] as CurrentVector).id;
	}
}
