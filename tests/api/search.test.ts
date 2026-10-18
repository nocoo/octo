import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_VERSION } from "../../apps/web/src/lib/version";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { encodeFloat32Vector, l2Normalize } from "../../apps/web/src/server/search/math";
import { assertAsyncTestMarker } from "../../scripts/local-d1";
import { e2eD1, query, sqlText } from "../fixtures/l2-batch";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const pepper = "change-me-api-key-pepper";
const VISIBLE = "mem_srch_l2_vis";
const HIDDEN = "mem_srch_l2_hid";
const TRASHED = "mem_srch_l2_trash";
const ACCENT = "mem_srch_l2_accent";
const PLAIN = "mem_srch_l2_plain";
const memoryIds = [VISIBLE, HIDDEN, TRASHED];
const quotedIds = [...memoryIds, ACCENT, PLAIN].map((id) => `'${id}'`).join(",");
const vector = { profile: "te3-small-1536", values: [3, 4, ...Array<number>(1534).fill(0)] };
const tokens: Record<string, string> = {};
const keyIds: Record<string, string> = {};

async function cleanup() {
	const d1 = await e2eD1();
	await assertAsyncTestMarker(d1);
	await d1([
		"--command",
		`
DELETE FROM memories_fts WHERE rowid IN (SELECT fts_rowid FROM memories_fts_map WHERE memory_id IN (${quotedIds}));
DELETE FROM memory_vectors WHERE memory_id IN (${quotedIds});
DELETE FROM memory_tags WHERE memory_id IN (${quotedIds});
DELETE FROM memories_fts_map WHERE memory_id IN (${quotedIds});
DELETE FROM memories WHERE id IN (${quotedIds});
DELETE FROM tags WHERE id IN ('tag_srch_alias','tag_srch_infra');
DELETE FROM spaces WHERE id IN ('sp_srch_l2_vis','sp_srch_l2_hid');
DELETE FROM idempotency_response_chunks WHERE key_id IN (SELECT id FROM api_keys WHERE name LIKE 'search-l2-%');
DELETE FROM idempotency_records WHERE key_id IN (SELECT id FROM api_keys WHERE name LIKE 'search-l2-%');
DELETE FROM audit_log WHERE actor IN (SELECT id FROM api_keys WHERE name LIKE 'search-l2-%');
DELETE FROM usage_daily WHERE key_id IN (SELECT id FROM api_keys WHERE name LIKE 'search-l2-%');
DELETE FROM api_keys WHERE name LIKE 'search-l2-%';`,
	]);
}

beforeAll(async () => {
	await cleanup();
	const d1 = await e2eD1();
	await assertAsyncTestMarker(d1);
	const now = Date.now();
	const commands: string[] = [];
	const keySpecs = [
		{ name: "admin", ops: "r,w,u,d", scope: "all", ids: [] },
		{ name: "scoped", ops: "r", scope: "spaces", ids: ["sp_srch_l2_vis"] },
		{ name: "replay-reader", ops: "r", scope: "spaces", ids: ["sp_srch_l2_vis"] },
		{ name: "write", ops: "w", scope: "all", ids: [] },
		{ name: "empty", ops: "r", scope: "own", ids: [] },
		{ name: "empty-write", ops: "w", scope: "own", ids: [] },
	];
	let source = "";
	for (const spec of keySpecs) {
		const material = generateApiKeyMaterial();
		tokens[spec.name] = material.plaintext;
		keyIds[spec.name] = material.keyid;
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
VALUES ('${id}','${space}','部署 cloudflare worker','正文包含部署与 cloudflare worker 配置 𠮷野','procedure',0.8,'${source}',${now},'hash',${now},${now},${id === TRASHED ? now : "NULL"});
INSERT INTO memories_fts(title,body,tags) VALUES ('部署 cloudflare worker','正文包含部署与 cloudflare worker 配置 𠮷野','search-infra');
INSERT INTO memories_fts_map(memory_id,fts_rowid) SELECT '${id}', rowid FROM memories_fts ORDER BY rowid DESC LIMIT 1;
INSERT INTO memory_vectors (memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
VALUES ('${id}','te3-small-1536','text-embedding-3-small',1536,X'${blob}','hash',${now});
INSERT INTO memory_tags (memory_id, tag_id) VALUES ('${id}','tag_srch_infra');`);
	}
	for (const [id, body] of [
		[ACCENT, "e\u0301t"],
		[PLAIN, "et"],
	]) {
		commands.push(`INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
VALUES ('${id}','sp_srch_l2_vis','Accent fixture','${body}','note','${source}','hash',${now},${now});
INSERT INTO memories_fts(title,body,tags) VALUES ('Accent fixture','${body}','');
INSERT INTO memories_fts_map(memory_id,fts_rowid) SELECT '${id}', rowid FROM memories_fts ORDER BY rowid DESC LIMIT 1;`);
	}
	await d1(["--command", commands.join("\n")]);
});

afterAll(async () => {
	await cleanup();
});

async function post(path: string, body: unknown, key = "scoped", raw = false, idemKey?: string) {
	return fetch(`${base}/api/v1/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(key ? { Authorization: `Bearer ${tokens[key] ?? "invalid"}` } : {}),
			...(idemKey === undefined ? {} : { "Idempotency-Key": idemKey }),
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

	it("finds a two-code-point supplementary CJK term through the bounded fallback", async () => {
		const res = await post("search", { query: "𠮷野", mode: "fts" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchBody;
		expect(body.items.map((item) => item.id)).toEqual([VISIBLE]);
		expect(body.channels.fts).toEqual({ candidates: 1, partial: true });
	});

	it.each([
		{ query: "e\u0301t", id: ACCENT, partial: true },
		{ query: "fixture e\u0301t", id: ACCENT, partial: false },
		{ query: "fixture et", id: PLAIN, partial: false },
	])("preserves original short terms in $query", async ({ query, id, partial }) => {
		const batch = await post("memories:batchGet", { ids: [ACCENT] });
		expect(batch.status).toBe(200);
		expect(await batch.json()).toMatchObject({ items: [{ id: ACCENT, body: "e\u0301t" }] });
		const res = await post("search", { query, mode: "fts" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as SearchBody;
		expect(body.items.map((item) => item.id)).toEqual([id]);
		expect(body.channels.fts).toEqual({ candidates: 1, partial });
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

	it("searches a tag renamed through the API using shared Latin normalization", async () => {
		const renamed = await post("tags/search-infra/rename", { new_name: "CAFÉ" }, "admin");
		expect(renamed.status).toBe(200);
		try {
			for (const mode of ["fts", "vector", "hybrid"]) {
				for (const field of ["tags_all", "tags_any"]) {
					const res = await post("search", {
						query: "cloudflare",
						vector,
						mode,
						filters: { [field]: ["CAFÉ"] },
					});
					expect(res.status).toBe(200);
					const body = (await res.json()) as SearchBody;
					expect(body.items.map((item) => item.id)).toEqual([VISIBLE]);
					expect(body.items[0]?.tags).toEqual(["café"]);
				}
			}
		} finally {
			const restored = await post("tags/café/rename", { new_name: "search-infra" }, "admin");
			expect(restored.status).toBe(200);
		}
	});

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
		expect(oversized.status).toBe(413);
		expect(await oversized.json()).toMatchObject({ error: { code: "payload_too_large" } });
	});

	it("returns all missing for a zero-space read key", async () => {
		const res = await post("memories:batchGet", { ids: [VISIBLE, HIDDEN] }, "empty");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [], missing: [VISIBLE, HIDDEN] });
	});
});

describe.each(["search", "memories:batchGet"])("%s read-only idempotency boundary", (path) => {
	const original = path === "search" ? { query: "部署", mode: "fts" } : { ids: [VISIBLE] };
	const changed =
		path === "search" ? { query: "definitelyabsent", mode: "fts" } : { ids: [HIDDEN] };
	async function assertNoOutcome() {
		const d1 = await e2eD1();
		await assertAsyncTestMarker(d1);
		const counts = await query<{ records: number; chunks: number }>(
			d1,
			`SELECT
(SELECT count(*) FROM idempotency_records WHERE key_id = ${sqlText(keyIds["replay-reader"] as string)}) AS records,
(SELECT count(*) FROM idempotency_response_chunks WHERE key_id = ${sqlText(keyIds["replay-reader"] as string)}) AS chunks`,
		);
		expect(counts).toEqual([{ records: 0, chunks: 0 }]);
	}

	it("returns fresh results for changed input with the same idempotency key", async () => {
		const key = crypto.randomUUID();
		const first = await post(path, original, "replay-reader", false, key);
		expect(first.status).toBe(200);
		expect(first.headers.get("Idempotent-Replayed")).toBeNull();
		expect(await first.json()).toMatchObject({ items: [{ id: VISIBLE }] });
		const second = await post(path, changed, "replay-reader", false, key);
		expect(second.status).toBe(200);
		expect(second.headers.get("Idempotent-Replayed")).toBeNull();
		expect(await second.json()).toMatchObject({ items: [] });
		await assertNoOutcome();
	});

	it.each(["scope", "ops"])("honors %s revocation instead of replaying a read", async (field) => {
		const key = crypto.randomUUID();
		const first = await post(path, original, "replay-reader", false, key);
		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({ items: [{ id: VISIBLE }] });
		const d1 = await e2eD1();
		await assertAsyncTestMarker(d1);
		const id = sqlText(keyIds["replay-reader"] as string);
		try {
			await d1([
				"--command",
				field === "scope"
					? `UPDATE api_keys SET space_ids_json = '[]' WHERE id = ${id}`
					: `UPDATE api_keys SET ops = 'w' WHERE id = ${id}`,
			]);
			const second = await post(path, original, "replay-reader", false, key);
			expect(second.status).toBe(field === "scope" ? 200 : 403);
			expect(second.headers.get("Idempotent-Replayed")).toBeNull();
			expect(await second.json()).toMatchObject(
				field === "scope"
					? { items: [], ...(path === "memories:batchGet" ? { missing: [VISIBLE] } : {}) }
					: { error: { code: "forbidden" } },
			);
		} finally {
			await d1([
				"--command",
				`UPDATE api_keys SET space_ids_json = '["sp_srch_l2_vis"]', ops = 'r' WHERE id = ${id}`,
			]);
		}
		const restored = await post(path, original, "replay-reader", false, key);
		expect(restored.status).toBe(200);
		expect(restored.headers.get("Idempotent-Replayed")).toBeNull();
		expect(await restored.json()).toMatchObject({ items: [{ id: VISIBLE }] });
		await assertNoOutcome();
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
