import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_VERSION } from "../../apps/web/src/lib/version";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { encodeFloat32Vector, l2Normalize } from "../../apps/web/src/server/search/math";
import { root } from "../../scripts/e2e";
import { assertTestMarker, createD1Exec } from "../../scripts/local-d1";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const pepper = "change-me-api-key-pepper";
const VISIBLE = "mem_srch_l2_vis";
const HIDDEN = "mem_srch_l2_hid";
const TRASHED = "mem_srch_l2_trash";
const memoryIds = [VISIBLE, HIDDEN, TRASHED];
const quotedIds = memoryIds.map((id) => `'${id}'`).join(",");
const vector = { profile: "te3-small-1536", values: [3, 4, ...Array<number>(1534).fill(0)] };
const tokens: Record<string, string> = {};

function e2eD1() {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) throw new Error("OCTO_PERSIST and OCTO_CONFIG are required");
	return createD1Exec(join(root, "node_modules/.bin/wrangler"), root, persist, config);
}

function cleanup() {
	const d1 = e2eD1();
	assertTestMarker(d1);
	d1([
		"--command",
		`
DELETE FROM memories_fts WHERE rowid IN (SELECT fts_rowid FROM memories_fts_map WHERE memory_id IN (${quotedIds}));
DELETE FROM memory_vectors WHERE memory_id IN (${quotedIds});
DELETE FROM memory_tags WHERE memory_id IN (${quotedIds});
DELETE FROM memories_fts_map WHERE memory_id IN (${quotedIds});
DELETE FROM memories WHERE id IN (${quotedIds});
DELETE FROM tags WHERE id IN ('tag_srch_alias','tag_srch_infra');
DELETE FROM spaces WHERE id IN ('sp_srch_l2_vis','sp_srch_l2_hid');
DELETE FROM audit_log WHERE actor IN (SELECT id FROM api_keys WHERE name LIKE 'search-l2-%');
DELETE FROM usage_daily WHERE key_id IN (SELECT id FROM api_keys WHERE name LIKE 'search-l2-%');
DELETE FROM api_keys WHERE name LIKE 'search-l2-%';`,
	]);
}

beforeAll(async () => {
	cleanup();
	const d1 = e2eD1();
	assertTestMarker(d1);
	const now = Date.now();
	const commands: string[] = [];
	const keySpecs = [
		{ name: "admin", ops: "r,w,u,d", scope: "all", ids: [] },
		{ name: "scoped", ops: "r", scope: "spaces", ids: ["sp_srch_l2_vis"] },
		{ name: "write", ops: "w", scope: "all", ids: [] },
		{ name: "empty", ops: "r", scope: "own", ids: [] },
		{ name: "empty-write", ops: "w", scope: "own", ids: [] },
	];
	let source = "";
	for (const spec of keySpecs) {
		const material = generateApiKeyMaterial();
		tokens[spec.name] = material.plaintext;
		if (spec.name === "admin") source = material.keyid;
		const hash = await hashSecret(pepper, material.secret);
		commands.push(`INSERT INTO api_keys (id,name,secret_hash,role,ops,scope,space_ids_json,own_entries_only,auto_own_space,created_at,updated_at)
VALUES ('${material.keyid}','search-l2-${spec.name}','${hash}','project','${spec.ops}','${spec.scope}','${JSON.stringify(spec.ids)}',0,0,${now},${now});`);
	}
	commands.push(`INSERT INTO spaces (id,slug,name,created_at,updated_at) VALUES
('sp_srch_l2_vis','search-l2-vis','Visible',${now},${now}), ('sp_srch_l2_hid','search-l2-hid','Hidden',${now},${now});
INSERT INTO tags VALUES ('tag_srch_infra','search-infra','Search infra',NULL,${now},${now}), ('tag_srch_alias','search-old-infra','Search old infra','tag_srch_infra',${now},${now});`);
	const bytes = encodeFloat32Vector(l2Normalize(vector.values));
	const blob = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	for (const id of memoryIds) {
		const space = id === HIDDEN ? "sp_srch_l2_hid" : "sp_srch_l2_vis";
		commands.push(`INSERT INTO memories (id,space_id,title,body,type,importance,source_key_id,event_time,content_hash,created_at,updated_at,deleted_at)
VALUES ('${id}','${space}','部署 cloudflare worker','正文包含部署与 cloudflare worker 配置','procedure',0.8,'${source}',${now},'hash',${now},${now},${id === TRASHED ? now : "NULL"});
INSERT INTO memories_fts(title,body,tags) VALUES ('部署 cloudflare worker','正文包含部署与 cloudflare worker 配置','search-infra');
INSERT INTO memories_fts_map(memory_id,fts_rowid) SELECT '${id}', rowid FROM memories_fts ORDER BY rowid DESC LIMIT 1;
INSERT INTO memory_vectors (memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
VALUES ('${id}','te3-small-1536','text-embedding-3-small',1536,X'${blob}','hash',${now});
INSERT INTO memory_tags VALUES ('${id}','tag_srch_infra');`);
	}
	d1(["--command", commands.join("\n")]);
});

afterAll(() => cleanup());

async function post(path: string, body: unknown, key = "scoped", raw = false) {
	return fetch(`${base}/api/v1/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(key ? { Authorization: `Bearer ${tokens[key] ?? "invalid"}` } : {}),
		},
		body: raw ? String(body) : JSON.stringify(body),
	});
}

type SearchBody = {
	items: Array<{
		id: string;
		tags: string[];
		scores: { fts: { bm25: number } | null; vector: { similarity: number } | null };
	}>;
	channels: {
		fts: { candidates: number; partial: boolean };
		vector: { candidates: number; profile: string | null; truncated: boolean };
	};
};

describe("POST /api/v1/search", () => {
	it.each(["fts", "vector", "hybrid"])(
		"returns visible results and real channel scores in %s mode",
		async (mode) => {
			const res = await post("search", { query: "cloudflare 部署", vector, mode, limit: 5 });
			expect(res.status).toBe(200);
			expect(res.headers.get("X-Request-Id")).toBeTruthy();
			expect(res.headers.get("X-Octo-Version")).toBe(APP_VERSION);
			const body = (await res.json()) as SearchBody;
			expect(body.items.map((item) => item.id)).toEqual([VISIBLE]);
			expect(body.items[0]?.tags).toEqual(["search-infra"]);
			if (mode !== "vector") {
				expect(body.items[0]?.scores.fts?.bm25).toBeLessThan(0);
				expect(body.channels.fts.candidates).toBe(1);
			} else expect(body.items[0]?.scores.fts).toBeNull();
			if (mode !== "fts") {
				expect(body.items[0]?.scores.vector?.similarity).toBeCloseTo(1, 6);
				expect(body.channels.vector.candidates).toBe(1);
				expect(body.channels.vector.profile).toBe(vector.profile);
			} else expect(body.items[0]?.scores.vector).toBeNull();
		},
	);

	it("marks the bounded all-short fallback partial", async () => {
		const res = await post("search", { query: "部署", mode: "fts" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchBody;
		expect(body.items.map((item) => item.id)).toEqual([VISIBLE]);
		expect(body.channels.fts.partial).toBe(true);
	});

	it.each(["fts", "vector", "hybrid"])(
		"honors tags and visibility filters in %s mode",
		async (mode) => {
			for (const tags_all of [
				["search-old-infra", "search-infra"],
				["search-infra", "unknown"],
				["unknown"],
			]) {
				const res = await post("search", {
					query: "cloudflare",
					vector,
					mode,
					filters: { tags_all },
				});
				expect(res.status).toBe(200);
				const body = (await res.json()) as SearchBody;
				expect(body.items.map((item) => item.id)).toEqual(
					tags_all.includes("unknown") ? [] : [VISIBLE],
				);
			}
			const res = await post("search", {
				query: "cloudflare",
				vector,
				mode,
				filters: { spaces: ["search-l2-hid"] },
			});
			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({
				items: [],
				channels: { fts: { candidates: 0 }, vector: { candidates: 0, truncated: false } },
			});
		},
	);

	it.each(["fts", "vector", "hybrid"])(
		"returns empty results for a zero-space read key in %s mode",
		async (mode) => {
			const res = await post("search", { query: "cloudflare", vector, mode }, "empty");
			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({
				items: [],
				channels: { vector: { candidates: 0, truncated: false } },
			});
		},
	);

	it.each([
		{
			body: { vector: { profile: vector.profile, values: [1] }, mode: "vector" },
			code: "vector_dimension_mismatch",
		},
		{
			body: { vector: { profile: "unknown", values: [1] }, mode: "vector" },
			code: "validation_failed",
		},
		{
			body: {
				vector: { profile: vector.profile, values: Array<number>(1536).fill(0) },
				mode: "vector",
			},
			code: "validation_failed",
		},
		{ body: { query: "cloudflare", unknown: true }, code: "validation_failed" },
		{ body: {}, code: "validation_failed" },
	])("validates search input with $code", async ({ body, code }) => {
		const res = await post("search", body);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code } });
	});
});

describe("POST /api/v1/memories:batchGet", () => {
	it("returns ordered unique items and undifferentiated missing ids", async () => {
		const res = await post("memories:batchGet", {
			ids: [VISIBLE, HIDDEN, TRASHED, "missing", VISIBLE],
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			items: [{ id: VISIBLE }],
			missing: [HIDDEN, TRASHED, "missing"],
		});
	});

	it("accepts 100 ids and rejects 101", async () => {
		const ids = [VISIBLE, ...Array.from({ length: 99 }, (_, i) => `missing${i}`)];
		const res = await post("memories:batchGet", { ids });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ items: [{ id: VISIBLE }], missing: ids.slice(1) });
		const oversized = await post("memories:batchGet", { ids: [...ids, "overflow"] });
		expect(oversized.status).toBe(400);
		expect(await oversized.json()).toMatchObject({ error: { code: "validation_failed" } });
	});

	it("returns all missing for a zero-space read key", async () => {
		const res = await post("memories:batchGet", { ids: [VISIBLE, HIDDEN] }, "empty");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [], missing: [VISIBLE, HIDDEN] });
	});
});

describe.each(["search", "memories:batchGet"])("%s shared boundary contract", (path) => {
	it.each(["", "invalid", "write", "empty-write"])("rejects caller %s", async (key) => {
		const res = await post(
			path,
			path === "search" ? { query: "cloudflare" } : { ids: [VISIBLE] },
			key,
		);
		const status = key.includes("write") ? 403 : 401;
		expect(res.status).toBe(status);
		expect(await res.json()).toMatchObject({
			error: { code: status === 403 ? "forbidden" : "unauthenticated" },
		});
	});

	it("returns validation_failed for malformed JSON", async () => {
		const res = await post(path, "{", "scoped", true);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: { code: "validation_failed", request_id: expect.any(String) },
		});
	});
});
