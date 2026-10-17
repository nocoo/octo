import { describe, expect, it } from "vitest";
import { e2eD1, query } from "../fixtures/l2-batch";

describe("FTS5 trigram on local D1", () => {
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
