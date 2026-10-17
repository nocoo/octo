import type { MemoryFilters } from "../../lib/schema/filters";
import { d1Results } from "../lib/d1";
import { buildMemoryFilterSql, tagsAllExistsSql, tagsAnyExistsSql } from "./filters-sql";
import { chunkIds } from "./sql-in";
import { resolveCanonicalTagIds, resolveRequiredTagIds } from "./tag-resolve";
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
		const resolved = await resolveRequiredTagIds(db, filters.tags_all);
		if (resolved === null) {
			return { hits: [], partial: false };
		}
		if (resolved.length > 0) {
			const t = tagsAllExistsSql(resolved);
			tagClauses.push(t.sql);
			tagBinds.push(...t.binds);
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
		hits = await filterShortTermsOnCandidates(
			db,
			hits,
			tokenized.shortTerms,
			base,
			tagClauses,
			tagBinds,
		);
	}
	return { hits, partial: false };
}

async function filterShortTermsOnCandidates(
	db: D1Database,
	hits: FtsHit[],
	shortTerms: string[],
	base: ReturnType<typeof buildMemoryFilterSql>,
	tagClauses: string[],
	tagBinds: string[],
): Promise<FtsHit[]> {
	if (hits.length === 0) {
		return hits;
	}
	const instrParts = shortTerms.map(() => "(instr(m.body, ?) > 0 OR instr(m.title, ?) > 0)");
	const instrBinds = shortTerms.flatMap((term) => [term, term]);
	const allowed = new Set<string>();
	for (const idChunk of chunkIds(hits.map((h) => h.id))) {
		const idIn = idChunk.map(() => "?").join(", ");
		const where = [...base.clauses, ...tagClauses, `m.id IN (${idIn})`, ...instrParts].join(
			" AND ",
		);
		const sql = `SELECT m.id AS id FROM memories m WHERE ${where}`;
		const rows = await db
			.prepare(sql)
			.bind(...base.binds, ...tagBinds, ...idChunk, ...instrBinds)
			.all<{ id: string }>();
		for (const row of d1Results(rows)) {
			allowed.add(row.id);
		}
	}
	return hits.filter((hit) => allowed.has(hit.id));
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
	const probeLimit = FTS_SHORT_SCAN_LIMIT + 1;
	const rows = await db
		.prepare(sql)
		.bind(...base.binds, ...tagBinds, ...likeBinds, probeLimit)
		.all<{ id: string }>();
	const resultRows = d1Results(rows);
	const partial = resultRows.length > FTS_SHORT_SCAN_LIMIT;
	const scanned = resultRows.slice(0, FTS_SHORT_SCAN_LIMIT);
	const capped = scanned.slice(0, candidateK);
	const hits = capped.map((r, idx) => ({ id: r.id, bm25: idx + 1 }));
	return { hits, partial };
}
