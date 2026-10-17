import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const persist = process.env.OCTO_PERSIST ?? "";
const config = process.env.OCTO_CONFIG ?? "";

function d1(sql: string): void {
	execFileSync(
		join(process.cwd(), "node_modules/.bin/wrangler"),
		[
			"d1",
			"execute",
			"octo-db",
			"--local",
			`--persist-to=${persist}`,
			`--config=${config}`,
			"--command",
			sql,
		],
		{ encoding: "utf8" },
	);
}

const adminId = "aaaaaaaaaaaa";
const readerId = "bbbbbbbbbbbb";
const dropId = "cccccccccccc";

describe("tags api", () => {
	it("covers list, rename conflict/success, merge, and auth", async () => {
		d1(
			`INSERT OR IGNORE INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, auto_own_space, created_at, updated_at) VALUES ('${adminId}', 'm3-admin', 'x', 'admin', 'r,w,u,d', 'all', '[]', 0, 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, auto_own_space, created_at, updated_at) VALUES ('${readerId}', 'm3-reader', 'x', 'readonly', 'r', 'spaces', '[]', 0, 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, auto_own_space, created_at, updated_at) VALUES ('${dropId}', 'm3-drop', 'x', 'drop', 'w', 'all', '[]', 0, 1, 1)`,
		);
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

		const anon = await fetch(`${base}/api/v1/tags`);
		expect(anon.status).toBe(401);

		const drop = await fetch(`${base}/api/v1/tags`, {
			headers: { Authorization: `Bearer octo_${dropId}_secret` },
		});
		expect(drop.status).toBe(403);

		d1(`UPDATE api_keys SET space_ids_json = '["sp1"]' WHERE id = '${readerId}'`);
		const listed = await fetch(`${base}/api/v1/tags`, {
			headers: { Authorization: `Bearer octo_${readerId}_secret` },
		});
		expect(listed.status).toBe(200);
		const listBody = (await listed.json()) as {
			tags: Array<{ name: string; use_count: number }>;
		};
		const alpha = listBody.tags.find((t) => t.name === "alpha");
		expect(alpha?.use_count).toBe(1);

		const conflict = await fetch(`${base}/api/v1/tags/alpha/rename`, {
			method: "POST",
			headers: {
				Authorization: `Bearer octo_${adminId}_secret`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ new_name: "beta" }),
		});
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toMatchObject({
			error: { code: "tag_conflict", details: { suggest: "merge", into: "beta" } },
		});

		const renamed = await fetch(`${base}/api/v1/tags/alpha/rename`, {
			method: "POST",
			headers: {
				Authorization: `Bearer octo_${adminId}_secret`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ new_name: "gamma" }),
		});
		expect(renamed.status).toBe(200);

		const merged = await fetch(`${base}/api/v1/tags/gamma/merge`, {
			method: "POST",
			headers: {
				Authorization: `Bearer octo_${adminId}_secret`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ into: "beta" }),
		});
		expect(merged.status).toBe(200);
		expect(await merged.json()).toMatchObject({ memories: 2 });
	});
});
