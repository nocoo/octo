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

function auth(token: string) {
	return { Authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function seed(ops = "r,w,u,d") {
	const d1 = e2eD1();
	assertTestMarker(d1);
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	const now = Date.now();
	const spaceId = `ch-${material.keyid}`;
	const slug = `chg-${material.keyid.toLowerCase()}`;
	d1([
		"--command",
		`INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES ('${spaceId}', '${slug}', 'Changes', '', NULL, ${now}, ${now})`,
	]);
	d1([
		"--command",
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, expires_at, created_at, updated_at) VALUES ('${material.keyid}', 'chg-${material.keyid}', '${secretHash}', 'admin', '${ops}', 'all', '[]', 0, 0, NULL, ${now}, ${now})`,
	]);
	return { token: material.plaintext, slug };
}

describe("change feed", () => {
	it("lists visible events, hides delete payloads, and returns head", async () => {
		const { token, slug } = await seed();
		const created = await fetch(`${base}/api/v1/memories`, {
			method: "POST",
			headers: auth(token),
			body: JSON.stringify({
				space: slug,
				title: "t",
				body: "b",
				type: "note",
				tags: [],
			}),
		});
		expect(created.status).toBe(201);
		const item = (await created.json()) as { id: string };
		expect(
			(
				await fetch(`${base}/api/v1/memories/${item.id}`, {
					method: "DELETE",
					headers: auth(token),
				})
			).status,
		).toBe(200);

		const listed = await fetch(`${base}/api/v1/changes?spaces=${slug}&limit=50`, {
			headers: auth(token),
		});
		expect(listed.status).toBe(200);
		const feed = (await listed.json()) as {
			items: Array<{ op: string; entity_id: string; actor?: string }>;
			next_cursor: string | null;
		};
		expect(feed.items.some((row) => row.op === "created" && row.entity_id === item.id)).toBe(true);
		const trashed = feed.items.find((row) => row.op === "trashed" && row.entity_id === item.id);
		expect(trashed).toBeTruthy();
		expect(trashed).not.toHaveProperty("actor");

		const head = await fetch(`${base}/api/v1/changes/head?spaces=${slug}`, {
			headers: auth(token),
		});
		expect(head.status).toBe(200);
		expect(await head.json()).toMatchObject({ cursor: expect.any(String) });
	});

	it("rejects unauthenticated and write-only keys", async () => {
		expect((await fetch(`${base}/api/v1/changes`)).status).toBe(401);
		expect((await fetch(`${base}/api/v1/changes/head`)).status).toBe(401);
		const writer = await seed("w");
		expect((await fetch(`${base}/api/v1/changes`, { headers: auth(writer.token) })).status).toBe(
			403,
		);
		expect(
			(await fetch(`${base}/api/v1/changes/head`, { headers: auth(writer.token) })).status,
		).toBe(403);
	});
});
