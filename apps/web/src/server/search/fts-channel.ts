import type { MemoryFilters } from "../../lib/schema/filters";
import { d1Results } from "../lib/d1";
import { resolveMemoryFilterSql } from "./filters-sql";
import { buildFtsMatchQuery, escapeFtsToken, supportsTrigram, tokenizeQuery } from "./tokenizer";

export type FtsHit = { id: string; bm25: number };
export type FtsChannelResult = { hits: FtsHit[]; partial: false };

export async function runFtsChannel(
	db: D1Database,
	query: string,
	spaceIds: string[],
	filters: MemoryFilters | undefined,
	candidateK: number,
): Promise<FtsChannelResult> {
	const terms = tokenizeQuery(query);
	const base = await resolveMemoryFilterSql(db, filters, spaceIds);
	if (!terms.length || base.clauses.includes("1 = 0")) return { hits: [], partial: false };
	const tables = terms.every(supportsTrigram)
		? ["memories_words_fts", "memories_fts"]
		: ["memories_words_fts"];
	for (const operator of terms.length > 1 ? (["AND", "OR"] as const) : (["AND"] as const)) {
		for (const table of tables) {
			const rows = await db
				.prepare(`
SELECT m.id, bm25(${table}, 5.0, 1.0, 2.0) AS score
FROM ${table}
JOIN memories_fts_map map ON map.fts_rowid = ${table}.rowid
JOIN memories m ON m.id = map.memory_id
WHERE ${table} MATCH ? AND ${base.clauses.join(" AND ")}
ORDER BY score, m.id LIMIT ?`)
				.bind(buildFtsMatchQuery(terms, operator), ...base.binds, candidateK)
				.all<{ id: string; score: number }>();
			const hits = d1Results(rows).map((row) => ({ id: row.id, bm25: row.score }));
			if (hits.length) return { hits, partial: false };
		}
		const shortTerms = terms.filter((term) => /^\p{Script=Han}{2}$/u.test(term));
		if (!shortTerms.length) continue;
		const match = terms
			.map((term) =>
				shortTerms.includes(term) ? `(${buildFtsMatchQuery([...term])})` : escapeFtsToken(term),
			)
			.join(` ${operator} `);
		const checks = [
			`${operator === "AND" ? "NOT EXISTS" : "EXISTS"} (
SELECT 1 FROM json_each(?) term WHERE ${operator === "AND" ? "NOT" : ""}
(instr(m.title, term.value) > 0 OR instr(m.body, term.value) > 0 OR EXISTS (
SELECT 1 FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id
WHERE mt.memory_id = m.id AND instr(t.name, term.value) > 0)))`,
		];
		const binds: unknown[] = [JSON.stringify(shortTerms)];
		const otherTerms = terms.filter((term) => !shortTerms.includes(term));
		if (operator === "OR" && otherTerms.length) {
			checks.push(
				"memories_words_fts.rowid IN (SELECT rowid FROM memories_words_fts WHERE memories_words_fts MATCH ?)",
			);
			binds.push(buildFtsMatchQuery(otherTerms, "OR"));
		}
		const rows = await db
			.prepare(`
SELECT m.id, bm25(memories_words_fts, 5.0, 1.0, 2.0) AS score
FROM memories_words_fts
JOIN memories_fts_map map ON map.fts_rowid = memories_words_fts.rowid
JOIN memories m ON m.id = map.memory_id
WHERE memories_words_fts MATCH ? AND ${base.clauses.join(" AND ")}
AND (${checks.join(` ${operator} `)})
ORDER BY score, m.id LIMIT ?`)
			.bind(match, ...base.binds, ...binds, candidateK)
			.all<{ id: string; score: number }>();
		const hits = d1Results(rows).map((row) => ({ id: row.id, bm25: row.score }));
		if (hits.length) return { hits, partial: false };
	}
	return { hits: [], partial: false };
}
