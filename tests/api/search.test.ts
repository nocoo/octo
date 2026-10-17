import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { encodeFloat32Vector, l2Normalize } from "../../apps/web/src/server/search/math";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec } from "../../scripts/local-d1";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const pepper = "change-me-api-key-pepper";

function e2eD1() {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) {
		throw new Error("OCTO_PERSIST and OCTO_CONFIG are required");
	}
	return createD1Exec(join(root, "node_modules/.bin/wrangler"), root, persist, config);
}

let token = "";

async function seedSearchFixture() {
	const d1 = e2eD1();
	assertTestMarker(d1);
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(pepper, material.secret);
	token = material.plaintext;
	const now = Date.now();
	d1([
		"--command",
		`INSERT OR REPLACE INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, created_at, updated_at)
     VALUES ('${material.keyid}', 'search-e2e', '${secretHash}', 'admin', 'r,w,u,d', 'all', '[]', 0, 0, ${now}, ${now})`,
	]);
	d1([
		"--command",
		`INSERT OR REPLACE INTO spaces (id, slug, name, description, created_at, updated_at)
     VALUES ('space1', 'kb-bot', 'KB', '', ${now}, ${now})`,
	]);
	d1([
		"--command",
		`INSERT OR REPLACE INTO memories (id, space_id, title, body, type, importance, source_key_id, content_hash, created_at, updated_at, version)
     VALUES ('mem1', 'space1', '部署 Cloudflare Worker', '正文包含部署与 cloudflare worker 配置', 'procedure', 0.8, '${material.keyid}', 'hash1', ${now}, ${now}, 1),
            ('mem2', 'space1', '短词', '只有部署二字', 'note', 0.5, '${material.keyid}', 'hash2', ${now - 1}, ${now - 1}, 1)`,
	]);
	d1(["--command", "DELETE FROM memories_fts_map WHERE memory_id IN ('mem1', 'mem2')"]);
	d1([
		"--command",
		"INSERT INTO memories_fts(title, body, tags) VALUES('部署 Cloudflare Worker','正文包含部署与 cloudflare worker 配置','infra')",
	]);
	d1([
		"--command",
		"INSERT OR REPLACE INTO memories_fts_map(memory_id, fts_rowid) SELECT 'mem1', rowid FROM memories_fts ORDER BY rowid DESC LIMIT 1",
	]);
	const vec = encodeFloat32Vector(l2Normalize([1, 0, 0].concat(Array(1533).fill(0))));
	const blob = [...vec].map((b) => b.toString(16).padStart(2, "0")).join("");
	d1([
		"--command",
		`INSERT OR REPLACE INTO memory_vectors (memory_id, profile_id, embedding_model, dim, vector, content_hash, updated_at)
     VALUES ('mem1', 'te3-small-1536', 'text-embedding-3-small', 1536, X'${blob}', 'hash1', ${now})`,
	]);
}

beforeAll(async () => {
	await seedSearchFixture();
});

describe("POST /api/v1/search", () => {
	it("returns fts hits with channel metadata", async () => {
		const res = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query: "cloudflare", limit: 5 }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{ id: string; scores: { fts: unknown; fused: number } }>;
			channels: { fts: { candidates: number; partial: boolean } };
		};
		expect(body.items.some((i) => i.id === "mem1")).toBe(true);
		expect(body.channels.fts.candidates).toBeGreaterThan(0);
		expect(body.items[0]?.scores.fused).toBeDefined();
	});

	it("finds 部署 via bounded LIKE when the query is all short terms", async () => {
		const res = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query: "部署", mode: "fts", limit: 5 }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{ id: string }>;
			channels: { fts: { partial: boolean } };
		};
		expect(body.items.map((i) => i.id).sort()).toEqual(["mem1", "mem2"]);
		expect(body.channels.fts.partial).toBe(false);
	});
});

describe("POST /api/v1/memories:batchGet", () => {
	it("returns items and undifferentiated missing ids", async () => {
		const res = await fetch(`${base}/api/v1/memories:batchGet`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ ids: ["mem1", "missing", "mem2"] }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: Array<{ id: string }>; missing: string[] };
		expect(body.items.map((i) => i.id).sort()).toEqual(["mem1", "mem2"]);
		expect(body.missing.sort()).toEqual(["missing"]);
	});

	it("rejects unauthenticated callers", async () => {
		const res = await fetch(`${base}/api/v1/memories:batchGet`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ids: ["mem1"] }),
		});
		expect(res.status).toBe(401);
	});
});
