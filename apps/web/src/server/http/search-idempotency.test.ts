import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { generateApiKeyMaterial, hashSecret } from "../auth/api-key";
import type { Env } from "../env";
import { createApp } from "../index";

async function fixture() {
	const f = sqliteD1();
	const material = generateApiKeyMaterial();
	const hash = await hashSecret("pepper", material.secret);
	f.sqlite
		.prepare(`INSERT INTO api_keys (id,name,secret_hash,role,ops,scope,space_ids_json,created_at,updated_at)
VALUES (?,'search-reader',?,'project','r','spaces','["read-space"]',1,1)`)
		.run(material.keyid, hash);
	f.sqlite.exec(`INSERT INTO spaces (id,slug,name,created_at,updated_at) VALUES ('read-space','read-space','Read',1,1);
INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
VALUES ('read-one','read-space','First','aa','note','k','hash',1,1), ('read-two','read-space','Second','bb','note','k','hash',1,1);`);
	const app = createApp();
	const post = (path: string, body: unknown, key = "read-key") =>
		app.request(
			`/api/v1/${path}`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${material.plaintext}`,
					"Content-Type": "application/json",
					"Idempotency-Key": key,
				},
				body: JSON.stringify(body),
			},
			{ DB: f.db, API_KEY_PEPPER: "pepper" } as Env,
		);
	return { ...f, post, material };
}

const cases = [
	{ path: "search", body: { query: "aa", mode: "fts" }, changed: { query: "bb", mode: "fts" } },
	{ path: "memories:batchGet", body: { ids: ["read-one"] }, changed: { ids: ["read-two"] } },
];

describe.each(cases)("read-only POST $path at the M6 boundary", ({ path, body, changed }) => {
	it("executes changed input freshly and never stores read outcomes", async () => {
		const f = await fixture();
		try {
			for (const [input, id] of [
				[body, "read-one"],
				[changed, "read-two"],
			] as const) {
				const response = await f.post(path, input);
				expect(response.status).toBe(200);
				expect(response.headers.get("Idempotent-Replayed")).toBeNull();
				expect(await response.json()).toMatchObject({ items: [{ id }] });
			}
			expect(f.sqlite.prepare("SELECT * FROM idempotency_records").all()).toEqual([]);
			expect(f.sqlite.prepare("SELECT * FROM idempotency_response_chunks").all()).toEqual([]);
		} finally {
			f.sqlite.close();
		}
	});

	it.each(["scope", "ops"])("honors current %s instead of replaying old content", async (field) => {
		const f = await fixture();
		try {
			expect((await f.post(path, body)).status).toBe(200);
			f.sqlite
				.prepare(
					field === "scope"
						? "UPDATE api_keys SET space_ids_json = '[]' WHERE id = ?"
						: "UPDATE api_keys SET ops = 'w' WHERE id = ?",
				)
				.run(f.material.keyid);
			const response = await f.post(path, body);
			expect(response.status).toBe(field === "scope" ? 200 : 403);
			expect(response.headers.get("Idempotent-Replayed")).toBeNull();
			expect(await response.json()).toMatchObject(
				field === "scope"
					? { items: [], ...(path === "memories:batchGet" ? { missing: ["read-one"] } : {}) }
					: { error: { code: "forbidden" } },
			);
			expect(f.sqlite.prepare("SELECT * FROM idempotency_records").all()).toEqual([]);
			expect(f.sqlite.prepare("SELECT * FROM idempotency_response_chunks").all()).toEqual([]);
		} finally {
			f.sqlite.close();
		}
	});

	it.each(["", "valid-key"])("bypasses key parsing and replay storage for key %j", async (key) => {
		const f = await fixture();
		try {
			const prepare = f.db.prepare.bind(f.db);
			vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
				if (sql.includes("idempotency_")) throw new Error("read reached replay storage");
				return prepare(sql);
			});
			const response = await f.post(path, body, key);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ items: [{ id: "read-one" }] });
		} finally {
			f.sqlite.close();
		}
	});
});
