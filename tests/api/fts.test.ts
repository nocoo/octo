import { describe, expect, it } from "vitest";
import { tokenizeQuery } from "../../apps/web/src/server/search/tokenizer";
import { assertAsyncTestMarker } from "../../scripts/local-d1";
import { e2eD1, query } from "../fixtures/l2-batch";

describe("FTS5 trigram on local D1", () => {
	it("classifies effective term length like the actual remove_diacritics tokenizer", async () => {
		const d1 = await e2eD1();
		const terms = [
			"e\u0301t",
			"e\u0301ta",
			"e\u0301\u0323t",
			"ét",
			"étab",
			"가나",
			"가나다",
			"가ᄂ",
			"𠮷野",
			"𠮷野家",
			"e\u1ab0t",
			"e\u1dc0t",
			"e\u20d0t",
			"e\ufe20t",
			"किता",
			...Array.from({ length: 112 }, (_, i) => `a${String.fromCodePoint(0x300 + i)}b`),
		];
		await d1([
			"--command",
			`CREATE VIRTUAL TABLE m4_term_probe USING fts5(body, tokenize='trigram remove_diacritics 1');
CREATE VIRTUAL TABLE m4_term_vocab USING fts5vocab(m4_term_probe, 'instance');`,
		]);
		try {
			await d1([
				"--command",
				terms
					.map((term, i) => `INSERT INTO m4_term_probe(rowid,body) VALUES (${i + 1},'${term}');`)
					.join("\n"),
			]);
			const tokens = await query<{ doc: number; term: string }>(
				d1,
				"SELECT doc,term FROM m4_term_vocab ORDER BY doc;",
			);
			const indexed = new Set(tokens.map((token) => token.doc));
			for (const [i, term] of terms.entries()) {
				expect(tokenizeQuery(term).longTerms.length > 0, JSON.stringify(term)).toBe(
					indexed.has(i + 1),
				);
			}
			expect(tokens.filter((token) => token.doc === 2).map((token) => token.term)).toEqual(["eta"]);
		} finally {
			await assertAsyncTestMarker(d1);
			await d1(["--command", "DROP TABLE m4_term_vocab; DROP TABLE m4_term_probe;"]);
		}
	});

	it("matches Chinese ≥3 chars, English substrings, and records 2-char + bm25 behaviour", async () => {
		const d1 = await e2eD1();
		await d1([
			"--command",
			"INSERT INTO memories_fts(title, body, tags) VALUES('部署 Cloudflare Worker','正文包含部署与 cloudflare worker 配置','infra')",
		]);
		await d1([
			"--command",
			"INSERT INTO memories_fts(title, body, tags) VALUES('三个字标题','abcdefghij substring 部署手册','ops')",
		]);
		const match = async (q: string) =>
			(
				await query<{ rowid: number }>(
					d1,
					`SELECT rowid FROM memories_fts WHERE memories_fts MATCH '${q.replaceAll("'", "''")}'`,
				)
			).map((row) => row.rowid);
		const chinese = await match("三个字");
		const english = await match("cdef");
		const cloudflare = await match("cloudflare");
		expect(chinese).toHaveLength(1);
		expect(english).toEqual(chinese);
		expect(cloudflare).toHaveLength(1);
		expect(cloudflare[0]).not.toBe(chinese[0]);
		expect(await match("部署")).toEqual([]);
		const ordered = await query<{ rowid: number; score: number }>(
			d1,
			"SELECT rowid, bm25(memories_fts, 5.0, 1.0, 2.0) AS score FROM memories_fts WHERE memories_fts MATCH '部署手册 OR cloudflare' ORDER BY score",
		);
		expect(ordered.length).toBeGreaterThan(0);
		expect(ordered[0]?.score).toBeLessThanOrEqual(ordered.at(-1)?.score ?? 0);
		await d1(["--command", `DELETE FROM memories_fts WHERE rowid = ${cloudflare[0]}`]);
		expect(await match("cloudflare")).toEqual([]);
	});
});
