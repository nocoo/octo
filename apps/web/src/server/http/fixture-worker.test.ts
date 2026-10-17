import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import fixtureWorker from "../../../../../tests/fixtures/worker";
import { generateApiKeyMaterial, hashSecret } from "../auth/api-key";
import type { Env } from "../env";
import { worker } from "../index";

async function fixture() {
	const { db, sqlite } = sqliteD1();
	sqlite.exec(
		"CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT); INSERT INTO _test_marker VALUES ('env', 'test')",
	);
	const key = generateApiKeyMaterial();
	const hash = await hashSecret("pepper", key.secret);
	sqlite
		.prepare(
			"INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'r,w,u,d', 'all', 0, 0)",
		)
		.run(key.keyid, key.keyid, hash);
	const env = { DB: db, RESOURCE_ENV: "test", API_KEY_PEPPER: "pepper" } as Env;
	const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
	const request = () =>
		new Request("http://local/api/v1/memories:batchCreate", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key.plaintext}`,
				"Content-Type": "application/json",
				"Idempotency-Key": "fixture",
			},
			body: JSON.stringify({
				items: [{ space: "kb", title: "t", body: "b", type: "note", tags: [] }],
			}),
		});
	return { db, sqlite, env, ctx, request };
}

describe("explicit test injection", () => {
	it("uses real M1 auth while production never mounts fixtures even in test env", async () => {
		const f = await fixture();
		expect((await worker.fetch(f.request(), f.env, f.ctx)).status).toBe(404);
		const res = await fixtureWorker.fetch(f.request(), f.env, f.ctx);
		// Use a fresh client key after the production 404 outcome above.
		const req = f.request();
		req.headers.set("Idempotency-Key", "actual-fixture");
		expect(res.status).toBe(404);
		const created = await fixtureWorker.fetch(req, f.env, f.ctx);
		expect(created.status).toBe(200);
		expect(await created.json()).toMatchObject({ results: [{ ok: true }] });
		expect(f.sqlite.prepare("SELECT * FROM _m6_memories").all()).toHaveLength(1);
		const noAuth = f.request();
		noAuth.headers.delete("Authorization");
		expect((await fixtureWorker.fetch(noAuth, f.env, f.ctx)).status).toBe(401);
		f.sqlite.close();
	});
	it("refuses fixture initialization without explicit test environment and marker", async () => {
		const f = await fixture();
		await expect(
			fixtureWorker.fetch(f.request(), { ...f.env, RESOURCE_ENV: "production" }, f.ctx),
		).rejects.toThrow("refusing fixture");
		f.sqlite.exec("UPDATE _test_marker SET value = 'production'");
		await expect(fixtureWorker.fetch(f.request(), f.env, f.ctx)).rejects.toThrow(
			"refusing fixture",
		);
		f.sqlite.close();
	});
});
