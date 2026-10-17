import type { MemoryFilters } from "../../lib/schema/filters";
import { d1Results } from "../lib/d1";
import { resolveMemoryFilterSql, type SqlFilter } from "./filters-sql";
import { sqlInClause } from "./sql-in";
import { buildFtsMatchQuery, FTS_SHORT_SCAN_LIMIT, tokenizeQuery } from "./tokenizer";

export type FtsHit = { id: string; bm25: number };
export type FtsChannelResult = { hits: FtsHit[]; partial: boolean };

export async function runFtsChannel(
	db: D1Database,
	query: string,
	spaceIds: string[],
	filters: MemoryFilters | undefined,
	candidateK: number,
): Promise<FtsChannelResult> {
	const tokenized = tokenizeQuery(query);
	const base = await resolveMemoryFilterSql(db, filters, spaceIds);
	if (base.clauses.includes("1 = 0")) return { hits: [], partial: false };
	if (tokenized.allShort) {
		const rows = await db
			.prepare(`
WITH scan AS MATERIALIZED (
	SELECT m.id, m.title, m.body, m.updated_at FROM memories m
	WHERE ${base.clauses.join(" AND ")}
	ORDER BY m.updated_at DESC, m.id DESC LIMIT ?
)
SELECT m.id FROM scan m
WHERE NOT EXISTS (
	SELECT 1 FROM json_each(?) term
	WHERE NOT (m.title LIKE '%' || term.value || '%' OR m.body LIKE '%' || term.value || '%')
)
ORDER BY m.updated_at DESC, m.id DESC LIMIT ?`)
			.bind(...base.binds, FTS_SHORT_SCAN_LIMIT, JSON.stringify(tokenized.shortTerms), candidateK)
			.all<{ id: string }>();
		return { hits: d1Results(rows).map((row, i) => ({ id: row.id, bm25: i + 1 })), partial: true };
	}
	const match = buildFtsMatchQuery(tokenized.longTerms);
	if (!match) return { hits: [], partial: false };
	const rows = await db
		.prepare(`
SELECT m.id, bm25(memories_fts, 5.0, 1.0, 2.0) AS score
FROM memories_fts
JOIN memories_fts_map map ON map.fts_rowid = memories_fts.rowid
JOIN memories m ON m.id = map.memory_id
WHERE memories_fts MATCH ? AND ${base.clauses.join(" AND ")}
ORDER BY score LIMIT ?`)
		.bind(match, ...base.binds, candidateK)
		.all<{ id: string; score: number }>();
	let hits = d1Results(rows).map((row) => ({ id: row.id, bm25: row.score }));
	if (tokenized.shortTerms.length && hits.length) {
		hits = await filterShortTermsOnCandidates(db, hits, tokenized.shortTerms, base);
	}
	return { hits, partial: false };
}

async function filterShortTermsOnCandidates(
	db: D1Database,
	hits: FtsHit[],
	shortTerms: string[],
	base: SqlFilter,
): Promise<FtsHit[]> {
	const ids = sqlInClause(
		"m.id",
		hits.map((hit) => hit.id),
	);
	const rows = await db
		.prepare(`
SELECT m.id FROM memories m
WHERE ${[...base.clauses, ids.sql].join(" AND ")}
AND NOT EXISTS (
	SELECT 1 FROM json_each(?) term
	WHERE instr(m.body, term.value) = 0 AND instr(m.title, term.value) = 0
)`)
		.bind(...base.binds, ...ids.binds, JSON.stringify(shortTerms))
		.all<{ id: string }>();
	const allowed = new Set(d1Results(rows).map((row) => row.id));
	return hits.filter((hit) => allowed.has(hit.id));
}
