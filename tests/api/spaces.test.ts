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

const adminId = "dddddddddddd";
const scopedId = "eeeeeeeeeeee";

describe("spaces api", () => {
	it("lists and gets only visible spaces", async () => {
		d1(
			`INSERT OR IGNORE INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, auto_own_space, created_at, updated_at) VALUES ('${adminId}', 'm3-space-admin', 'x', 'admin', 'r,w,u,d', 'all', '[]', 0, 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, auto_own_space, created_at, updated_at) VALUES ('${scopedId}', 'm3-space-scoped', 'x', 'custom', 'r', 'spaces', '["sp-vis"]', 0, 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO spaces (id, slug, name, description, created_at, updated_at) VALUES ('sp-vis', 'visible-room', 'Visible', '', 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO spaces (id, slug, name, description, created_at, updated_at) VALUES ('sp-hid', 'hidden-room', 'Hidden', '', 1, 1)`,
		);
		d1(
			`INSERT OR IGNORE INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at) VALUES ('mem-vis', 'sp-vis', 't', 'b', 'note', 0.5, 'k', 1, 'h', 1, 1)`,
		);

		const anon = await fetch(`${base}/api/v1/spaces`);
		expect(anon.status).toBe(401);

		const listed = await fetch(`${base}/api/v1/spaces`, {
			headers: { Authorization: `Bearer octo_${scopedId}_secret` },
		});
		expect(listed.status).toBe(200);
		const body = (await listed.json()) as { spaces: Array<{ slug: string; memory_count: number }> };
		expect(body.spaces.map((s) => s.slug)).toEqual(["visible-room"]);
		expect(body.spaces[0]?.memory_count).toBe(1);

		const one = await fetch(`${base}/api/v1/spaces/visible-room`, {
			headers: { Authorization: `Bearer octo_${scopedId}_secret` },
		});
		expect(one.status).toBe(200);

		const hidden = await fetch(`${base}/api/v1/spaces/hidden-room`, {
			headers: { Authorization: `Bearer octo_${scopedId}_secret` },
		});
		expect(hidden.status).toBe(404);

		const adminList = await fetch(`${base}/api/v1/spaces`, {
			headers: { Authorization: `Bearer octo_${adminId}_secret` },
		});
		expect(adminList.status).toBe(200);
		const all = (await adminList.json()) as { spaces: Array<{ slug: string }> };
		const slugs = all.spaces.map((s) => s.slug);
		expect(slugs).toContain("hidden-room");
		expect(slugs).toContain("visible-room");
	});
});
