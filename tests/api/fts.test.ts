import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec, type D1Exec } from "../../scripts/local-d1";

function e2eD1(): D1Exec {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) {
		throw new Error("OCTO_PERSIST and OCTO_CONFIG are required");
	}
	return createD1Exec(join(root, "node_modules/.bin/wrangler"), root, persist, config);
}

function rows<T>(stdout: string): T[] {
	const start = stdout.indexOf("[");
	const parsed = JSON.parse(stdout.slice(start)) as Array<{ results?: T[] }>;
	return parsed[0]?.results ?? [];
}

describe("FTS5 trigram on local D1", () => {
	it("matches Chinese ≥3 chars, English substrings, and records 2-char + bm25 behaviour", () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		d1([
			"--command",
			"INSERT INTO memories_fts(title, body, tags) VALUES('部署 Cloudflare Worker','正文包含部署与 cloudflare worker 配置','infra')",
		]);
		d1([
			"--command",
			"INSERT INTO memories_fts(title, body, tags) VALUES('三个字标题','abcdefghij substring 部署手册','ops')",
		]);
		const match = (q: string) =>
			rows<{ rowid: number }>(
				d1([
					"--command",
					`SELECT rowid FROM memories_fts WHERE memories_fts MATCH '${q.replaceAll("'", "''")}'`,
					"--json",
				]),
			).map((row) => row.rowid);
		const chinese = match("三个字");
		const english = match("cdef");
		const cloudflare = match("cloudflare");
		expect(chinese).toHaveLength(1);
		expect(english).toEqual(chinese);
		expect(cloudflare).toHaveLength(1);
		expect(cloudflare[0]).not.toBe(chinese[0]);
		expect(match("部署")).toEqual([]);
		const ordered = rows<{ rowid: number; score: number }>(
			d1([
				"--command",
				"SELECT rowid, bm25(memories_fts, 5.0, 1.0, 2.0) AS score FROM memories_fts WHERE memories_fts MATCH '部署手册 OR cloudflare' ORDER BY score",
				"--json",
			]),
		);
		expect(ordered.length).toBeGreaterThan(0);
		expect(ordered[0]?.score).toBeLessThanOrEqual(ordered.at(-1)?.score ?? 0);
		d1(["--command", `DELETE FROM memories_fts WHERE rowid = ${cloudflare[0]}`]);
		expect(match("cloudflare")).toEqual([]);
	});
});
