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

function auth(token: string, extra: Record<string, string> = {}) {
	return { Authorization: `Bearer ${token}`, "content-type": "application/json", ...extra };
}

async function seed(ops = "r,w,u,d") {
	const d1 = e2eD1();
	assertTestMarker(d1);
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	const now = Date.now();
	const spaceId = `sp-${material.keyid}`;
	const slug = `m2-${material.keyid.toLowerCase()}`;
	const profile = `p-${material.keyid}`;
	d1([
		"--command",
		`INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES ('${spaceId}', '${slug}', 'M2', '', NULL, ${now}, ${now})`,
	]);
	d1([
		"--command",
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'm2-${material.keyid}', '${secretHash}', 'admin', '${ops}', 'all', '[]', 0, 0, NULL, ${now}, ${now})`,
	]);
	d1([
		"--command",
		`INSERT INTO embedding_profiles (id, model, dims, metric, vectorize_index, active, created_at) VALUES ('${profile}', 'tiny', 3, 'cosine', 'x', 0, ${now})`,
	]);
	return { token: material.plaintext, slug, profile };
}

describe("memory CRUD", () => {
	it("creates, reads, lists, patches, versions, diffs, rollbacks, and trashes", async () => {
		const { token, slug, profile } = await seed();
		const created = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(token),
			body: JSON.stringify({
				space: slug,
				title: "Caddy",
				body: "line1\nline2\n",
				type: "procedure",
				tags: ["Infra"],
				importance: 0.8,
				vector: { profile, values: [0, 1, 0] },
			}),
		});
		expect(created.status).toBe(201);
		const item = (await created.json()) as { id: string; version: number; tags: string[] };
		expect(item.tags).toEqual(["infra"]);
		expect(item.version).toBe(1);

		const got = await fetch(
			`${base}/api/v1/memories/${item.id}?include=versions_count,attachments,vector_status`,
			{ headers: auth(token) },
		);
		expect(got.status).toBe(200);
		expect(await got.json()).toMatchObject({
			id: item.id,
			versions_count: 1,
			attachments: [],
			vector_status: [{ profile, indexed: false, stale: false }],
		});

		const patched = await fetch(`${base}/api/v1/memories/${item.id}`, {
			method: "PATCH",
			headers: auth(token, { "If-Match": "1" }),
			body: JSON.stringify({ title: "Caddy 2", body: "line1\nline3\n" }),
		});
		expect(patched.status).toBe(200);
		expect(await patched.json()).toMatchObject({ version: 2, title: "Caddy 2" });

		const conflict = await fetch(`${base}/api/v1/memories/${item.id}`, {
			method: "PATCH",
			headers: auth(token, { "If-Match": "1" }),
			body: JSON.stringify({ title: "nope" }),
		});
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toMatchObject({
			error: { code: "version_conflict", details: { current_version: 2 } },
		});

		const versions = await fetch(`${base}/api/v1/memories/${item.id}/versions`, {
			headers: auth(token),
		});
		expect(versions.status).toBe(200);
		expect(await versions.json()).toMatchObject({ items: [{ version: 1 }, { version: 2 }] });

		const v1 = await fetch(`${base}/api/v1/memories/${item.id}/versions/1`, {
			headers: auth(token),
		});
		expect(await v1.json()).toMatchObject({ version: 1, body: "line1\nline2\n" });

		const diff = await fetch(`${base}/api/v1/memories/${item.id}/diff?from=1&to=2`, {
			headers: auth(token),
		});
		const diffBody = (await diff.json()) as {
			body: { unified: string };
			fields: Array<{ field: string }>;
		};
		expect(diffBody.body.unified).toContain("-line2");
		expect(diffBody.fields.some((field) => field.field === "title")).toBe(true);

		const rolled = await fetch(`${base}/api/v1/memories/${item.id}/rollback`, {
			method: "POST",
			headers: auth(token, { "If-Match": "2" }),
			body: JSON.stringify({ to_version: 1 }),
		});
		expect(rolled.status).toBe(200);
		expect(await rolled.json()).toMatchObject({ version: 3, title: "Caddy", tags: ["infra"] });

		const listed = await fetch(`${base}/api/v1/memories?spaces=${slug}&types=procedure`, {
			headers: auth(token),
		});
		const listBody = (await listed.json()) as { items: Array<{ id: string }> };
		expect(listBody.items.some((row) => row.id === item.id)).toBe(true);

		const deleted = await fetch(`${base}/api/v1/memories/${item.id}`, {
			method: "DELETE",
			headers: auth(token),
		});
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toMatchObject({ trashed_at: expect.any(String) });
		expect(
			(await fetch(`${base}/api/v1/memories/${item.id}`, { headers: auth(token) })).status,
		).toBe(404);

		const trash = await fetch(`${base}/api/v1/trash`, { headers: auth(token) });
		const trashBody = (await trash.json()) as { items: Array<{ id: string }> };
		expect(trashBody.items.some((row) => row.id === item.id)).toBe(true);

		const restored = await fetch(`${base}/api/v1/trash/${item.id}/restore`, {
			method: "POST",
			headers: auth(token),
		});
		expect(restored.status).toBe(200);
		const restoredBody = (await restored.json()) as { version: number; deleted_at?: string };
		expect(restoredBody.version).toBe(4);
		expect(restoredBody.deleted_at).toBeUndefined();
	});

	it("rejects unauthenticated, forbidden, unknown space, and bad payloads", async () => {
		const reader = await seed("r");
		const denied = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(reader.token),
			body: JSON.stringify({
				space: reader.slug,
				title: "t",
				body: "b",
				type: "note",
				tags: [],
			}),
		});
		expect(denied.status).toBe(403);

		const writer = await seed("w");
		const created = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(writer.token),
			body: JSON.stringify({
				space: writer.slug,
				title: "t",
				body: "b",
				type: "note",
				tags: [],
			}),
		});
		expect(created.status).toBe(201);
		const item = (await created.json()) as { id: string };
		expect(
			(await fetch(`${base}/api/v1/memories/${item.id}`, { headers: auth(writer.token) })).status,
		).toBe(403);

		const admin = await seed();
		expect((await fetch(`${base}/api/v1/memories`)).status).toBe(401);
		const unknown = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(admin.token),
			body: JSON.stringify({
				space: "missing-space",
				title: "t",
				body: "b",
				type: "note",
				tags: [],
			}),
		});
		expect(unknown.status).toBe(404);
		const bad = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(admin.token),
			body: "nope",
		});
		expect(bad.status).toBe(400);
		const dim = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(admin.token),
			body: JSON.stringify({
				space: admin.slug,
				title: "t",
				body: "b",
				type: "note",
				tags: [],
				vector: { profile: admin.profile, values: [1] },
			}),
		});
		expect(dim.status).toBe(400);
		expect(await dim.json()).toMatchObject({ error: { code: "vector_dimension_mismatch" } });
		const missingRollback = await fetch(`${base}/api/v1/memories/${item.id}/rollback`, {
			method: "POST",
			headers: auth(admin.token, { "If-Match": "1" }),
			body: JSON.stringify({ to_version: 99 }),
		});
		expect(missingRollback.status).toBe(422);
		const huge = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(admin.token),
			body: JSON.stringify({
				space: admin.slug,
				title: "t",
				body: "x".repeat(1_100_000),
				type: "note",
				tags: [],
			}),
		});
		expect(huge.status).toBe(413);
	});

	it("creates an auto own space on first write and rejects a taken slug", async () => {
		const d1 = e2eD1();
		assertTestMarker(d1);
		const material = generateApiKeyMaterial();
		const secretHash = await hashSecret(pepper, material.secret);
		const now = Date.now();
		const slug = `alice-${material.keyid.toLowerCase()}`;
		d1([
			"--command",
			`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', '${slug}', '${secretHash}', 'project', 'r,w,u,d', 'own', '[]', 0, 1, NULL, ${now}, ${now})`,
		]);
		const created = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(material.plaintext),
			body: JSON.stringify({
				space: slug,
				title: "t",
				body: "b",
				type: "note",
				tags: [],
			}),
		});
		expect(created.status).toBe(201);
		expect(await created.json()).toMatchObject({ space: slug });

		const taken = generateApiKeyMaterial();
		const takenHash = await hashSecret(pepper, taken.secret);
		const takenSlug = `taken-${taken.keyid.toLowerCase()}`;
		d1([
			"--command",
			`INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES ('sp-${taken.keyid}', '${takenSlug}', 'Taken', '', 'other', ${now}, ${now})`,
		]);
		d1([
			"--command",
			`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${taken.keyid}', '${takenSlug}', '${takenHash}', 'project', 'r,w,u,d', 'own', '[]', 0, 1, NULL, ${now}, ${now})`,
		]);
		const rejected = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(taken.plaintext),
			body: JSON.stringify({
				space: takenSlug,
				title: "t",
				body: "b",
				type: "note",
				tags: [],
			}),
		});
		expect(rejected.status).toBe(422);
		expect(await rejected.json()).toMatchObject({ error: { code: "unprocessable" } });
	});
});
