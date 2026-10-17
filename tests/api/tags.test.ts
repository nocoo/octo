import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec, type D1Exec } from "../../scripts/local-d1";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";

function e2eD1(): D1Exec {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) {
		throw new Error("OCTO_PERSIST and OCTO_CONFIG are required");
	}
	return createD1Exec(join(root, "node_modules/.bin/wrangler"), root, persist, config);
}

function d1(sql: string, json = false): string {
	const exec = e2eD1();
	assertTestMarker(exec);
	return exec(json ? ["--json", "--command", sql] : ["--command", sql]);
}

function rows<T>(stdout: string): T[] {
	const start = stdout.indexOf("[");
	const parsed = JSON.parse(stdout.slice(start)) as Array<{ results?: T[] }>;
	return parsed[0]?.results ?? [];
}

function inject(id: string, over: Record<string, unknown> = {}): Record<string, string> {
	return {
		Authorization: `Bearer octo_${id}_x`,
		"X-Octo-Test-Key": JSON.stringify({
			id,
			name: id,
			ops: "r,w,u,d",
			scope: "all",
			space_ids_json: "[]",
			own_entries_only: 0,
			auto_own_space: 0,
			expires_at: null,
			revoked_at: null,
			...over,
		}),
	};
}

const adminId = "aaaaaaaaaaaa";
const readerId = "bbbbbbbbbbbb";
const dropId = "cccccccccccc";
const scopedId = "ffffffffffff";

describe("tags api", () => {
	it("covers list, rename, merge, auth, and d1 effects", async () => {
		d1(
			`INSERT OR IGNORE INTO spaces (id, slug, name, description, created_at, updated_at) VALUES ('sp1', 'm3-vis', 'vis', '', 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO spaces (id, slug, name, description, created_at, updated_at) VALUES ('sp2', 'm3-hid', 'hid', '', 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO tags (id, name, display_name, created_at, updated_at) VALUES ('tg1', 'alpha', 'alpha', 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO tags (id, name, display_name, created_at, updated_at) VALUES ('tg2', 'beta', 'beta', 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at) VALUES ('mm1', 'sp1', 't', 'b', 'note', 0.5, 'k', 1, 'h', 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at) VALUES ('mm2', 'sp2', 't', 'b', 'note', 0.5, 'k', 1, 'h', 1, 1)`,
		);
		d1(`INSERT OR IGNORE INTO memory_tags (memory_id, tag_id) VALUES ('mm1', 'tg1')`);
		d1(`INSERT OR IGNORE INTO memory_tags (memory_id, tag_id) VALUES ('mm2', 'tg1')`);
		d1(`INSERT OR IGNORE INTO memory_tags (memory_id, tag_id) VALUES ('mm1', 'tg2')`);
		const anon = await fetch(`${base}/api/v1/tags`);
		expect(anon.status).toBe(401);

		const drop = await fetch(`${base}/api/v1/tags`, {
			headers: inject(dropId, { ops: "w" }),
		});
		expect(drop.status).toBe(403);

		const listed = await fetch(`${base}/api/v1/tags`, {
			headers: inject(readerId, { ops: "r", scope: "spaces", space_ids_json: '["sp1"]' }),
		});
		expect(listed.status).toBe(200);
		const listBody = (await listed.json()) as {
			items: Array<{ name: string; use_count: number }>;
			next_cursor: string | null;
		};
		expect(listBody.next_cursor).toBeNull();
		const alpha = listBody.items.find((t) => t.name === "alpha");
		expect(alpha?.use_count).toBe(1);

		const readerRename = await fetch(`${base}/api/v1/tags/alpha/rename`, {
			method: "POST",
			headers: {
				...inject(readerId, { ops: "r", scope: "all" }),
				"content-type": "application/json",
			},
			body: JSON.stringify({ new_name: "gamma" }),
		});
		expect(readerRename.status).toBe(403);

		const scopedMerge = await fetch(`${base}/api/v1/tags/alpha/merge`, {
			method: "POST",
			headers: {
				...inject(scopedId, { ops: "u", scope: "spaces", space_ids_json: '["sp1"]' }),
				"content-type": "application/json",
			},
			body: JSON.stringify({ into: "beta" }),
		});
		expect(scopedMerge.status).toBe(403);

		const conflict = await fetch(`${base}/api/v1/tags/alpha/rename`, {
			method: "POST",
			headers: { ...inject(adminId), "content-type": "application/json" },
			body: JSON.stringify({ new_name: "beta" }),
		});
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toMatchObject({
			error: { code: "tag_conflict", details: { suggest: "merge", into: "beta" } },
		});

		const missing = await fetch(`${base}/api/v1/tags/nope/merge`, {
			method: "POST",
			headers: { ...inject(adminId), "content-type": "application/json" },
			body: JSON.stringify({ into: "beta" }),
		});
		expect(missing.status).toBe(404);

		const selfMerge = await fetch(`${base}/api/v1/tags/alpha/merge`, {
			method: "POST",
			headers: { ...inject(adminId), "content-type": "application/json" },
			body: JSON.stringify({ into: "alpha" }),
		});
		expect(selfMerge.status).toBe(400);

		const renamed = await fetch(`${base}/api/v1/tags/alpha/rename`, {
			method: "POST",
			headers: { ...inject(adminId), "content-type": "application/json" },
			body: JSON.stringify({ new_name: "gamma" }),
		});
		expect(renamed.status).toBe(200);
		const renamedBody = (await renamed.json()) as { name: string; updated_at: string };
		expect(renamedBody.name).toBe("gamma");
		expect(renamedBody.updated_at).toMatch(/Z$/);

		const merged = await fetch(`${base}/api/v1/tags/gamma/merge`, {
			method: "POST",
			headers: { ...inject(adminId), "content-type": "application/json" },
			body: JSON.stringify({ into: "beta" }),
		});
		expect(merged.status).toBe(200);
		expect(await merged.json()).toMatchObject({ memories: 2 });

		const links = rows<{ memory_id: string; tag_id: string }>(
			d1(
				"SELECT memory_id, tag_id FROM memory_tags WHERE memory_id IN ('mm1','mm2') ORDER BY memory_id, tag_id",
				true,
			),
		);
		expect(links).toEqual([
			{ memory_id: "mm1", tag_id: "tg2" },
			{ memory_id: "mm2", tag_id: "tg2" },
		]);
		const versions = rows<{ version: number }>(
			d1("SELECT version FROM memories WHERE id IN ('mm1','mm2')", true),
		);
		expect(versions.every((row) => row.version === 1)).toBe(true);
		const changes = rows<{ entity_id: string }>(
			d1("SELECT entity_id FROM changes WHERE op = 'tag_merged' ORDER BY entity_id", true),
		);
		expect(changes.map((row) => row.entity_id)).toEqual(["mm1", "mm2"]);
		const gammaHits = rows<{ n: number }>(
			d1("SELECT COUNT(*) AS n FROM memories_fts WHERE memories_fts MATCH 'gamma'", true),
		);
		expect(Number(gammaHits[0]?.n ?? 0)).toBe(0);
		const betaHits = rows<{ n: number }>(
			d1("SELECT COUNT(*) AS n FROM memories_fts WHERE memories_fts MATCH 'beta'", true),
		);
		expect(Number(betaHits[0]?.n ?? 0)).toBeGreaterThan(0);
	});
});
