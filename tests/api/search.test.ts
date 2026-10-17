import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { encodeFloat32Vector, l2Normalize } from "../../apps/web/src/server/search/math";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec } from "../../scripts/local-d1";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const pepper = "change-me-api-key-pepper";

const SPACE_VIS = "sp_srch_l2_vis";
const SPACE_HID = "sp_srch_l2_hid";
const MEM_VIS = "mem_srch_l2_vis";
const MEM_HID = "mem_srch_l2_hid";

function e2eD1() {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) {
		throw new Error("OCTO_PERSIST and OCTO_CONFIG are required");
	}
	return createD1Exec(join(root, "node_modules/.bin/wrangler"), root, persist, config);
}

let adminToken = "";
let scopedToken = "";
let writeOnlyToken = "";
let emptyScopeToken = "";

function authHeaders(token: string) {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
}

async function seedSearchFixture() {
	const d1 = e2eD1();
	assertTestMarker(d1);
	d1([
		"--command",
		`DELETE FROM memory_vectors WHERE memory_id IN ('${MEM_VIS}', '${MEM_HID}'); DELETE FROM memories_fts_map WHERE memory_id IN ('${MEM_VIS}', '${MEM_HID}'); DELETE FROM memories WHERE id IN ('${MEM_VIS}', '${MEM_HID}'); DELETE FROM spaces WHERE id IN ('${SPACE_VIS}', '${SPACE_HID}');`,
	]);
	const admin = generateApiKeyMaterial();
	const scoped = generateApiKeyMaterial();
	const writeOnly = generateApiKeyMaterial();
	const emptyScope = generateApiKeyMaterial();
	const now = Date.now();
	const insertKey = async (
		material: ReturnType<typeof generateApiKeyMaterial>,
		name: string,
		ops: string,
		scope: string,
		spaceIdsJson: string,
	) => {
		const secretHash = await hashSecret(pepper, material.secret);
		d1([
			"--command",
			`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, created_at, updated_at)
       VALUES ('${material.keyid}', '${name}', '${secretHash}', 'admin', '${ops}', '${scope}', '${spaceIdsJson}', 0, 0, ${now}, ${now})`,
		]);
		return material.plaintext;
	};
	adminToken = await insertKey(admin, "search-l2-admin", "r,w,u,d", "all", "[]");
	scopedToken = await insertKey(
		scoped,
		"search-l2-scoped",
		"r",
		"spaces",
		JSON.stringify([SPACE_VIS]),
	);
	writeOnlyToken = await insertKey(writeOnly, "search-l2-write", "w", "all", "[]");
	emptyScopeToken = await insertKey(emptyScope, "search-l2-empty", "r", "spaces", "[]");
	d1([
		"--command",
		`INSERT OR REPLACE INTO spaces (id, slug, name, description, created_at, updated_at)
     VALUES ('${SPACE_VIS}', 'search-l2-vis', 'Search visible', '', ${now}, ${now}),
            ('${SPACE_HID}', 'search-l2-hid', 'Search hidden', '', ${now}, ${now})`,
	]);
	d1([
		"--command",
		`INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, content_hash, created_at, updated_at, version)
     VALUES ('${MEM_VIS}', '${SPACE_VIS}', '部署 Cloudflare Worker', '正文包含部署与 cloudflare worker 配置', 'procedure', 0.8, '${admin.keyid}', 'hash_srch_vis', ${now}, ${now}, 1),
            ('${MEM_HID}', '${SPACE_HID}', 'hidden 部署', 'hidden body 部署', 'note', 0.5, '${admin.keyid}', 'hash_srch_hid', ${now}, ${now}, 1)`,
	]);
	d1([
		"--command",
		"INSERT INTO memories_fts(title, body, tags) VALUES('部署 Cloudflare Worker','正文包含部署与 cloudflare worker 配置','infra')",
	]);
	d1([
		"--command",
		`INSERT INTO memories_fts_map(memory_id, fts_rowid) SELECT '${MEM_VIS}', rowid FROM memories_fts ORDER BY rowid DESC LIMIT 1`,
	]);
	const vec = encodeFloat32Vector(l2Normalize([1, 0, 0].concat(Array(1533).fill(0))));
	const blob = [...vec].map((b) => b.toString(16).padStart(2, "0")).join("");
	d1([
		"--command",
		`INSERT INTO memory_vectors (memory_id, profile_id, embedding_model, dim, vector, content_hash, updated_at)
     VALUES ('${MEM_VIS}', 'te3-small-1536', 'text-embedding-3-small', 1536, X'${blob}', 'hash_srch_vis', ${now})`,
	]);
}

beforeAll(async () => {
	await seedSearchFixture();
});

afterAll(() => {
	const d1 = e2eD1();
	d1([
		"--command",
		`DELETE FROM memory_vectors WHERE memory_id IN ('${MEM_VIS}', '${MEM_HID}'); DELETE FROM memories_fts_map WHERE memory_id IN ('${MEM_VIS}', '${MEM_HID}'); DELETE FROM memories WHERE id IN ('${MEM_VIS}', '${MEM_HID}'); DELETE FROM spaces WHERE id IN ('${SPACE_VIS}', '${SPACE_HID}');`,
	]);
});

describe("POST /api/v1/search", () => {
	it("returns fts hits with channel metadata", async () => {
		const res = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: authHeaders(adminToken),
			body: JSON.stringify({ query: "cloudflare", limit: 5 }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{ id: string }>;
			channels: { fts: { candidates: number } };
		};
		expect(body.items.some((i) => i.id === MEM_VIS)).toBe(true);
		expect(body.channels.fts.candidates).toBeGreaterThan(0);
	});

	it("finds 部署 via bounded LIKE when the query is all short terms", async () => {
		const res = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: authHeaders(adminToken),
			body: JSON.stringify({ query: "部署", mode: "fts", limit: 5 }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{ id: string }>;
			channels: { fts: { partial: boolean } };
		};
		expect(body.items.map((i) => i.id)).toContain(MEM_VIS);
		expect(body.channels.fts.partial).toBe(false);
	});

	it("runs hybrid search with query and vector", async () => {
		const values = l2Normalize([1, 0, 0].concat(Array(1533).fill(0)));
		const res = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: authHeaders(adminToken),
			body: JSON.stringify({
				query: "cloudflare",
				vector: { profile: "te3-small-1536", values },
				limit: 5,
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{ id: string; scores: { vector: unknown } }>;
			channels: { vector: { profile: string | null } };
		};
		expect(body.items.some((i) => i.id === MEM_VIS)).toBe(true);
		expect(body.channels.vector.profile).toBe("te3-small-1536");
	});

	it("hides memories outside visible spaces", async () => {
		const res = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: authHeaders(scopedToken),
			body: JSON.stringify({ query: "部署", mode: "fts", limit: 10 }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: Array<{ id: string }> };
		expect(body.items.map((i) => i.id)).toEqual([MEM_VIS]);
	});

	it("returns empty results for read keys with no visible spaces", async () => {
		const res = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: authHeaders(emptyScopeToken),
			body: JSON.stringify({ query: "cloudflare", limit: 5 }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[] };
		expect(body.items).toEqual([]);
	});

	it("rejects keys without read permission", async () => {
		const res = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: authHeaders(writeOnlyToken),
			body: JSON.stringify({ query: "cloudflare", limit: 5 }),
		});
		expect(res.status).toBe(403);
	});

	it("returns 400 for invalid json and vector dimension mismatch", async () => {
		const badJson = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: authHeaders(adminToken),
			body: "{",
		});
		expect(badJson.status).toBe(400);
		const badVec = await fetch(`${base}/api/v1/search`, {
			method: "POST",
			headers: authHeaders(adminToken),
			body: JSON.stringify({
				vector: { profile: "te3-small-1536", values: [1, 2, 3] },
				mode: "vector",
				limit: 1,
			}),
		});
		expect(badVec.status).toBe(400);
		const body = (await badVec.json()) as { error: { code: string } };
		expect(body.error.code).toBe("vector_dimension_mismatch");
	});
});

describe("POST /api/v1/memories:batchGet", () => {
	it("returns items and undifferentiated missing ids", async () => {
		const res = await fetch(`${base}/api/v1/memories:batchGet`, {
			method: "POST",
			headers: authHeaders(adminToken),
			body: JSON.stringify({ ids: [MEM_VIS, "missing", MEM_HID] }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: Array<{ id: string }>; missing: string[] };
		expect(body.items.map((i) => i.id).sort()).toEqual([MEM_HID, MEM_VIS].sort());
		expect(body.missing).toEqual(["missing"]);
	});

	it("rejects unauthenticated callers", async () => {
		const res = await fetch(`${base}/api/v1/memories:batchGet`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ids: [MEM_VIS] }),
		});
		expect(res.status).toBe(401);
	});
});
