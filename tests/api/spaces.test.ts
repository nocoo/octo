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

function d1(sql: string): void {
	const exec = e2eD1();
	assertTestMarker(exec);
	exec(["--command", sql]);
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

const adminId = "dddddddddddd";
const scopedId = "eeeeeeeeeeee";
const writeId = "ffffffffff01";

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

		const listed = await fetch(`${base}/api/v1/spaces`, {
			headers: inject(scopedId, { ops: "r", scope: "spaces", space_ids_json: '["sp-vis"]' }),
		});
		expect(listed.status).toBe(200);
		const body = (await listed.json()) as {
			items: Array<{ slug: string; memory_count: number; created_at: string }>;
			next_cursor: string | null;
		};
		expect(body.next_cursor).toBeNull();
		expect(body.items.map((s) => s.slug)).toEqual(["visible-room"]);
		expect(body.items[0]?.memory_count).toBe(1);
		expect(body.items[0]?.created_at).toMatch(/Z$/);

		const one = await fetch(`${base}/api/v1/spaces/visible-room`, {
			headers: inject(scopedId, { ops: "r", scope: "spaces", space_ids_json: '["sp-vis"]' }),
		});
		expect(one.status).toBe(200);
		const detail = (await one.json()) as { slug: string; created_at: string };
		expect(detail.slug).toBe("visible-room");
		expect(detail.created_at).toMatch(/Z$/);

		const writeDenied = await fetch(`${base}/api/v1/spaces/visible-room`, {
			headers: inject(writeId, { ops: "w", scope: "spaces", space_ids_json: '["sp-vis"]' }),
		});
		expect(writeDenied.status).toBe(403);

		const hidden = await fetch(`${base}/api/v1/spaces/hidden-room`, {
			headers: inject(scopedId, { ops: "r", scope: "spaces", space_ids_json: '["sp-vis"]' }),
		});
		expect(hidden.status).toBe(404);

		const adminList = await fetch(`${base}/api/v1/spaces`, {
			headers: inject(adminId),
		});
		expect(adminList.status).toBe(200);
		const all = (await adminList.json()) as { items: Array<{ slug: string }> };
		const slugs = all.items.map((s) => s.slug);
		expect(slugs).toContain("hidden-room");
		expect(slugs).toContain("visible-room");
	});
});
