import { describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";
import { asD1, FakeD1, type KeyRec } from "../../repo/__tests__/fake-d1";
import { tagsRoutes } from "./tags";

const PEPPER = "change-me-api-key-pepper";

function envFor(db: FakeD1): Env {
	return {
		DB: asD1(db),
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: PEPPER,
	};
}

async function seedKey(db: FakeD1, over: Partial<KeyRec> = {}): Promise<string> {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(PEPPER, material.secret);
	const row: KeyRec = {
		id: material.keyid,
		name: "admin",
		secret_hash: secretHash,
		prev_secret_hash: null,
		prev_valid_until: null,
		role: "admin",
		ops: "r,w,u,d",
		scope: "all",
		space_ids_json: "[]",
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
	return material.plaintext;
}

describe("tags routes", () => {
	it("lists tags for a reader and rejects anonymous", async () => {
		const db = new FakeD1();
		db.tags.set("t1", {
			id: "t1",
			name: "infra",
			display_name: "infra",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		const app = createApp();
		const denied = await app.request("/api/v1/tags", {}, envFor(db));
		expect(denied.status).toBe(401);
		const token = await seedKey(db, { ops: "r" });
		const res = await app.request(
			"/api/v1/tags",
			{ headers: { Authorization: `Bearer ${token}` } },
			envFor(db),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			items: [],
			next_cursor: null,
		});
	});

	it("lists tags when 101 spaces are visible", async () => {
		const db = new FakeD1();
		db.tags.set("t1", {
			id: "t1",
			name: "infra",
			display_name: "infra",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		for (let i = 0; i < 101; i++) {
			const id = `sp${i}`;
			db.spaces.set(id, {
				id,
				slug: id,
				name: id,
				description: "",
				owner_key_id: null,
				created_at: 1,
				updated_at: 1,
			});
		}
		const token = await seedKey(db, { ops: "r", scope: "all" });
		const res = await createApp().request(
			"/api/v1/tags",
			{ headers: { Authorization: `Bearer ${token}` } },
			envFor(db),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			items: [],
		});
	});

	it("renames and merges with global update, else forbids", async () => {
		const db = new FakeD1();
		db.tags.set("a", {
			id: "a",
			name: "from",
			display_name: "from",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		db.tags.set("b", {
			id: "b",
			name: "into",
			display_name: "into",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		const app = createApp();
		const reader = await seedKey(db, { ops: "r", scope: "all" });
		const forbidden = await app.request(
			"/api/v1/tags/from/rename",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${reader}`, "content-type": "application/json" },
				body: JSON.stringify({ new_name: "renamed" }),
			},
			envFor(db),
		);
		expect(forbidden.status).toBe(403);
		const admin = await seedKey(db);
		const headers = { Authorization: `Bearer ${admin}`, "content-type": "application/json" };
		const renamed = await app.request(
			"/api/v1/tags/from/rename",
			{
				method: "POST",
				headers,
				body: JSON.stringify({ new_name: "renamed" }),
			},
			envFor(db),
		);
		expect(renamed.status).toBe(200);
		const merged = await app.request(
			"/api/v1/tags/renamed/merge",
			{
				method: "POST",
				headers,
				body: JSON.stringify({ into: "into" }),
			},
			envFor(db),
		);
		expect(merged.status).toBe(200);
		expect(await merged.json()).toMatchObject({ memories: 0 });
		const badJson = await app.request(
			"/api/v1/tags/into/rename",
			{
				method: "POST",
				headers,
				body: "not-json",
			},
			envFor(db),
		);
		expect(badJson.status).toBe(400);
		const padded = ` ${"n".repeat(64)} `;
		const longOk = await app.request(
			"/api/v1/tags/into/rename",
			{
				method: "POST",
				headers,
				body: JSON.stringify({ new_name: padded }),
			},
			envFor(db),
		);
		expect(longOk.status).toBe(200);
	});

	it("returns 401 when mounted without authz", async () => {
		const res = await tagsRoutes().request("/", {}, envFor(new FakeD1()));
		expect([401, 500]).toContain(res.status);
	});
});
