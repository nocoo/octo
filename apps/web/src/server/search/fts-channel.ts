import type { MemoryFilters } from "../../lib/schema/filters";
import { d1Results } from "../lib/d1";
import { buildMemoryFilterSql, tagsAllExistsSql, tagsAnyExistsSql } from "./filters-sql";
import { resolveCanonicalTagIds } from "./tag-resolve";
import { buildFtsMatchQuery, FTS_SHORT_SCAN_LIMIT, tokenizeQuery } from "./tokenizer";

export type FtsHit = {
	id: string;
	bm25: number;
};

export type FtsChannelResult = {
	hits: FtsHit[];
	partial: boolean;
};

const BM25_WEIGHTS = "5.0, 1.0, 2.0";

export async function runFtsChannel(
	db: D1Database,
	query: string,
	spaceIds: string[],
	filters: MemoryFilters | undefined,
	candidateK: number,
): Promise<FtsChannelResult> {
	const tokenized = tokenizeQuery(query);
	const base = buildMemoryFilterSql(filters, spaceIds);
	const tagClauses: string[] = [];
	const tagBinds: string[] = [];
	if (filters?.tags_all?.length) {
		const resolved = await resolveCanonicalTagIds(db, filters.tags_all);
		if (resolved.length > 0) {
			const t = tagsAllExistsSql(resolved);
			tagClauses.push(t.sql);
			tagBinds.push(...t.binds);
		} else {
			return { hits: [], partial: false };
		}
	}
	if (filters?.tags_any?.length) {
		const resolved = await resolveCanonicalTagIds(db, filters.tags_any);
		if (resolved.length > 0) {
			const t = tagsAnyExistsSql(resolved);
			tagClauses.push(t.sql);
			tagBinds.push(...t.binds);
		} else {
			return { hits: [], partial: false };
		}
	}

	if (tokenized.allShort) {
		return runShortLikeScan(db, tokenized.shortTerms, base, tagClauses, tagBinds, candidateK);
	}

	const match = buildFtsMatchQuery(tokenized.longTerms);
	if (!match) {
		return { hits: [], partial: false };
	}

	const where = [...base.clauses, ...tagClauses].join(" AND ");
	const sql = `
SELECT m.id AS id, bm25(memories_fts, ${BM25_WEIGHTS}) AS score
FROM memories_fts
JOIN memories_fts_map map ON map.fts_rowid = memories_fts.rowid
JOIN memories m ON m.id = map.memory_id
WHERE memories_fts MATCH ?
AND ${where}
ORDER BY score
LIMIT ?
`;
	const rows = await db
		.prepare(sql)
		.bind(match, ...base.binds, ...tagBinds, candidateK)
		.all<{ id: string; score: number }>();

	let hits = d1Results(rows).map((r) => ({ id: r.id, bm25: r.score }));
	if (tokenized.shortTerms.length > 0) {
		hits = await filterShortTerms(db, hits, tokenized.shortTerms);
	}
	return { hits, partial: false };
}

async function filterShortTerms(
	db: D1Database,
	hits: FtsHit[],
	shortTerms: string[],
): Promise<FtsHit[]> {
	if (hits.length === 0) {
		return hits;
	}
	const ids = hits.map((h) => h.id);
	const placeholders = ids.map(() => "?").join(", ");
	const rows = await db
		.prepare(`SELECT id, body FROM memories WHERE id IN (${placeholders})`)
		.bind(...ids)
		.all<{ id: string; body: string }>();
	const bodyById = new Map(d1Results(rows).map((r) => [r.id, r.body]));
	return hits.filter((hit) => {
		const body = bodyById.get(hit.id) ?? "";
		return shortTerms.every((term) => body.includes(term));
	});
}

async function runShortLikeScan(
	db: D1Database,
	shortTerms: string[],
	base: ReturnType<typeof buildMemoryFilterSql>,
	tagClauses: string[],
	tagBinds: string[],
	candidateK: number,
): Promise<FtsChannelResult> {
	const likeParts = shortTerms.map(() => "(m.title LIKE ? OR m.body LIKE ?)");
	const likeBinds = shortTerms.flatMap((t) => [`%${t}%`, `%${t}%`]);
	const where = [...base.clauses, ...tagClauses, ...likeParts].join(" AND ");
	const sql = `
SELECT m.id AS id, m.updated_at
FROM memories m
WHERE ${where}
ORDER BY m.updated_at DESC
LIMIT ?
`;
	const limit = Math.min(candidateK, FTS_SHORT_SCAN_LIMIT);
	const rows = await db
		.prepare(sql)
		.bind(...base.binds, ...tagBinds, ...likeBinds, limit)
		.all<{ id: string }>();
	const resultRows = d1Results(rows);
	const hits = resultRows.map((r, idx) => ({ id: r.id, bm25: idx + 1 }));
	return { hits, partial: resultRows.length === FTS_SHORT_SCAN_LIMIT };
}
