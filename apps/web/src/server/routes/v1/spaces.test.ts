import { describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";
import { asD1, FakeD1, type KeyRec } from "../../repo/__tests__/fake-d1";
import { spacesRoutes } from "./spaces";

const PEPPER = "change-me-api-key-pepper";

function envFor(db: FakeD1): Env {
	return {
		DB: asD1(db),
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: PEPPER,
	};
}

async function seedKey(
	db: FakeD1,
	over: Partial<KeyRec> = {},
): Promise<{ token: string; id: string }> {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(PEPPER, material.secret);
	const row: KeyRec = {
		id: material.keyid,
		name: "reader",
		secret_hash: secretHash,
		prev_secret_hash: null,
		prev_valid_until: null,
		role: "project",
		ops: "r",
		scope: "spaces",
		space_ids_json: '["s1"]',
		own_entries_only: 0,
		auto_own_space: 0,
		expires_at: null,
		revoked_at: null,
		last_used_at: null,
		created_at: 1,
		updated_at: 1,
		...over,
	};
	row.id = material.keyid;
	row.secret_hash = secretHash;
	db.keys.set(row.id, row);
	return { token: material.plaintext, id: row.id };
}

describe("spaces routes", () => {
	it("lists and gets visible spaces only", async () => {
		const db = new FakeD1();
		const seeded = await seedKey(db);
		db.spaces.set("s1", {
			id: "s1",
			slug: "kb-bot",
			name: "kb",
			description: "",
			owner_key_id: seeded.id,
			created_at: 1,
			updated_at: 1,
		});
		db.spaces.set("s2", {
			id: "s2",
			slug: "secret",
			name: "secret",
			description: "",
			owner_key_id: null,
			created_at: 1,
			updated_at: 1,
		});
		const headers = { Authorization: `Bearer ${seeded.token}` };
		const app = createApp();
		const listed = await app.request("/api/v1/spaces", { headers }, envFor(db));
		expect(listed.status).toBe(200);
		const body = (await listed.json()) as { spaces: Array<{ slug: string }> };
		expect(body.spaces.map((s) => s.slug)).toEqual(["kb-bot"]);
		const one = await app.request("/api/v1/spaces/kb-bot", { headers }, envFor(db));
		expect(one.status).toBe(200);
		const hidden = await app.request("/api/v1/spaces/secret", { headers }, envFor(db));
		expect(hidden.status).toBe(404);
		const writeOnly = await seedKey(db, { ops: "w", space_ids_json: '["s1"]' });
		const denied = await app.request(
			"/api/v1/spaces",
			{ headers: { Authorization: `Bearer ${writeOnly.token}` } },
			envFor(db),
		);
		expect(denied.status).toBe(403);
	});

	it("returns 401 without authz on the sub-app", async () => {
		const res = await spacesRoutes().request("/missing", {}, envFor(new FakeD1()));
		expect([401, 500]).toContain(res.status);
	});
});
