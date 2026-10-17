import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../tests/fixtures/sqlite-d1";
import { mintApiKey } from "./auth/api-key";
import type { Env } from "./env";
import { createApp } from "./index";

function fixture() {
	const { db, sqlite } = sqliteD1();
	const pending: Promise<unknown>[] = [];
	const env = {
		DB: db,
		RESOURCE_ENV: "development",
		ACCESS_DEV_BYPASS_EMAIL: "admin@local",
		API_KEY_PEPPER: "local-pepper",
		FILES: { delete: async () => {} },
	} as unknown as Env;
	const context = {
		waitUntil: (promise: Promise<unknown>) => {
			pending.push(promise);
		},
	} as unknown as ExecutionContext;
	const app = createApp();
	const request = async (path: string, method = "GET", body?: unknown) => {
		const response = await app.request(
			`/api/admin${path}`,
			{
				method,
				headers: { Origin: "https://octo.dev.hexly.ai", "Content-Type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			env,
			context,
		);
		await Promise.all(pending.splice(0));
		return response;
	};
	return { app, env, db, sqlite, pending, context, request };
}

describe("M7 production application integration", () => {
	it("mounts Access-only management, observations and settings", async () => {
		const { request } = fixture();
		for (const path of [
			"/keys",
			"/spaces",
			"/audit",
			"/usage",
			"/settings/embedding",
			"/embedding-profiles",
		]) {
			expect((await request(path)).status, path).toBe(200);
		}
	});

	it("never accepts an admin-role API key for management", async () => {
		const { app, env, db, context, pending, sqlite } = fixture();
		delete env.ACCESS_DEV_BYPASS_EMAIL;
		const key = await mintApiKey(db, "local-pepper", {
			name: "all",
			role: "admin",
			ops: "r,w,u,d",
			scope: "all",
		});
		for (const path of [
			"/keys",
			"/spaces",
			"/audit",
			"/usage",
			"/settings/embedding",
			"/embedding-profiles",
		]) {
			const response = await app.request(
				`/api/admin${path}`,
				{ headers: { Authorization: `Bearer ${key.plaintext}` } },
				env,
				context,
			);
			expect(response.status, path).toBe(401);
		}
		await Promise.all(pending);
		expect(
			sqlite.prepare("SELECT count(*) AS count FROM audit_log WHERE status = 401").get()?.count,
		).toBe(6);
		expect(JSON.stringify(sqlite.prepare("SELECT * FROM audit_log").all())).not.toContain(
			key.plaintext,
		);
	});

	it("keeps admin actor and reconciles create, metadata, trash, restore and purge after commit", async () => {
		const { request, sqlite } = fixture();
		const created = await request("/memories", "POST", {
			space: "kb",
			title: "lifecycle",
			body: "knowledge",
			type: "note",
			tags: [],
			vector: {
				profile: "te3-small-1536",
				values: Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)),
			},
		});
		expect(created.status).toBe(201);
		const memory = (await created.json()) as { id: string };
		const vector = () =>
			sqlite.prepare("SELECT indexed_at FROM memory_vectors WHERE memory_id = ?").get(memory.id);
		expect(vector()?.indexed_at).toEqual(expect.any(Number));
		expect(
			sqlite.prepare("SELECT actor FROM memory_versions WHERE memory_id = ?").get(memory.id)?.actor,
		).toBe("admin:admin@local");
		expect(
			(await request(`/memories/${memory.id}`, "PATCH", { expected_version: 1, type: "fact" }))
				.status,
		).toBe(200);
		expect(vector()?.indexed_at).toEqual(expect.any(Number));
		expect((await request(`/memories/${memory.id}`, "DELETE")).status).toBe(200);
		expect(vector()?.indexed_at).toBeNull();
		expect((await request(`/trash/${memory.id}/restore`, "POST")).status).toBe(200);
		expect(vector()?.indexed_at).toEqual(expect.any(Number));
		expect((await request(`/memories/${memory.id}`, "DELETE")).status).toBe(200);
		expect((await request(`/trash/${memory.id}`, "DELETE")).status).toBe(200);
		expect(vector()).toBeUndefined();
		expect(
			sqlite
				.prepare("SELECT synced_generation FROM vector_sync_jobs WHERE memory_id = ?")
				.get(memory.id)?.synced_generation,
		).toEqual(expect.any(Number));
		expect(
			sqlite
				.prepare("SELECT count(*) AS count FROM audit_log WHERE actor = 'admin:admin@local'")
				.get()?.count,
		).toBe(6);
	});

	it("falls back to full text for unconfigured dashboard query embeddings", async () => {
		const { request } = fixture();
		const response = await request("/search", "POST", { query: "knowledge" });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			channels: { vector: { skipped: "embedder_unavailable" } },
		});
	});
});
