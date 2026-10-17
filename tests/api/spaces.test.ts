import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec, type D1Exec } from "../../scripts/local-d1";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const pepper = "change-me-api-key-pepper";

function e2eD1(): D1Exec {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) {
		throw new Error("OCTO_PERSIST and OCTO_CONFIG are required");
	}
	return createD1Exec(join(root, "node_modules/.bin/wrangler"), root, persist, config);
}

function d1(sql: string): void {
	const exec = e2eD1();
	assertTestMarker(exec);
	exec(["--command", sql]);
}

async function mint(over: {
	ops?: string;
	scope?: string;
	space_ids_json?: string;
	role?: string;
}): Promise<Record<string, string>> {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	const now = Date.now();
	const ops = over.ops ?? "r,w,u,d";
	const scope = over.scope ?? "all";
	const spaceIds = over.space_ids_json ?? "[]";
	const role = over.role ?? "admin";
	d1(
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'e2e-${material.keyid}', '${secretHash}', '${role}', '${ops}', '${scope}', '${spaceIds}', 0, 0, NULL, ${now}, ${now})`,
	);
	return { Authorization: `Bearer ${material.plaintext}` };
}

describe("spaces api", () => {
	it("lists and gets only visible spaces", async () => {
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

		const scoped = await mint({
			ops: "r",
			scope: "spaces",
			space_ids_json: '["sp-vis"]',
			role: "project",
		});
		const listed = await fetch(`${base}/api/v1/spaces`, { headers: scoped });
		expect(listed.status).toBe(200);
		const body = (await listed.json()) as {
			items: Array<{ slug: string; memory_count: number; created_at: string }>;
			next_cursor: string | null;
		};
		expect(body.next_cursor).toBeNull();
		expect(body.items.map((s) => s.slug)).toEqual(["visible-room"]);
		expect(body.items[0]?.memory_count).toBe(1);
		expect(body.items[0]?.created_at).toMatch(/Z$/);

		const one = await fetch(`${base}/api/v1/spaces/visible-room`, { headers: scoped });
		expect(one.status).toBe(200);
		const detail = (await one.json()) as { slug: string; created_at: string };
		expect(detail.slug).toBe("visible-room");
		expect(detail.created_at).toMatch(/Z$/);

		const writeOnly = await mint({
			ops: "w",
			scope: "spaces",
			space_ids_json: '["sp-vis"]',
			role: "project",
		});
		const writeDenied = await fetch(`${base}/api/v1/spaces/visible-room`, { headers: writeOnly });
		expect(writeDenied.status).toBe(403);

		const hidden = await fetch(`${base}/api/v1/spaces/hidden-room`, { headers: scoped });
		expect(hidden.status).toBe(404);

		const admin = await mint({});
		const adminList = await fetch(`${base}/api/v1/spaces`, { headers: admin });
		expect(adminList.status).toBe(200);
		const all = (await adminList.json()) as { items: Array<{ slug: string }> };
		const slugs = all.items.map((s) => s.slug);
		expect(slugs).toContain("hidden-room");
		expect(slugs).toContain("visible-room");
	});
});
