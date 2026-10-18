import { afterEach, describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../../tests/fixtures/sqlite-d1";
import { mintApiKey } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

async function setup() {
	const { db, sqlite } = sqliteD1();
	databases.push(sqlite);
	const key = await mintApiKey(db, "patch-forms-pepper", {
		name: "patch-forms",
		role: "admin",
		ops: "r,w,u,d",
		scope: "all",
	});
	const app = createApp();
	const env = { DB: db, API_KEY_PEPPER: "patch-forms-pepper", RESOURCE_ENV: "test" } as Env;
	const request = (path: string, method: string, body: unknown, headers = {}) =>
		app.request(
			`/api/v1${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${key.plaintext}`,
					"Content-Type": "application/json",
					...headers,
				},
				body: JSON.stringify(body),
			},
			env,
		);
	const created = await request("/memories", "POST", {
		space: "kb",
		title: "original",
		body: "original body",
		type: "note",
		tags: [],
	});
	expect(created.status).toBe(201);
	const { id } = (await created.json()) as { id: string };
	return { request, sqlite, id };
}

describe("batch update forms HTTP contract", () => {
	it("accepts both forms, keeps sequential CAS and reauthorizes nested idempotent replay", async () => {
		const { request, id } = await setup();
		const body = {
			items: [
				{ id, title: "flat", importance: 0, expected_version: 1 },
				{ id, patch: { body: "nested", importance: 1, expected_version: 2 } },
				{ id, title: "stale flat", expected_version: 1 },
				{ id, patch: { title: "stale nested", expected_version: 2 } },
			],
		};
		const first = await request("/memories:batchUpdate", "POST", body, {
			"Idempotency-Key": "forms",
		});
		expect(first.status).toBe(200);
		const result = await first.json();
		expect(result).toMatchObject({
			results: [
				{ ok: true, item: { id, title: "flat", importance: 0, version: 2 } },
				{ ok: true, item: { id, title: "flat", body: "nested", importance: 1, version: 3 } },
				{ ok: false, error: { code: "version_conflict", details: { current_version: 3 } } },
				{ ok: false, error: { code: "version_conflict", details: { current_version: 3 } } },
			],
		});
		const replay = await request("/memories:batchUpdate", "POST", body, {
			"Idempotency-Key": "forms",
		});
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.json()).toEqual(result);
	});

	it.each([
		{ title: "flat", expected_version: 1, patch: { body: "nested", expected_version: 1 } },
		{ expected_version: 1, patch: { title: "nested" } },
		{ title: "flat", patch: { expected_version: 1 } },
		{ patch: { title: "nested", expected_version: 1, extra: true } },
		{ title: "missing version" },
		{ patch: { expected_version: 1 } },
		{ importance: -0.01, expected_version: 1 },
		{ patch: { importance: 1.01, expected_version: 1 } },
	])("rejects an invalid item before writing any part of the batch %j", async (item) => {
		const { request, id, sqlite } = await setup();
		const response = await request("/memories:batchUpdate", "POST", {
			items: [
				{ id, title: "must not be staged", expected_version: 1 },
				{ id, ...item },
			],
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
		expect(sqlite.prepare("SELECT title, version FROM memories WHERE id = ?").get(id)).toEqual({
			title: "original",
			version: 1,
		});
		expect(sqlite.prepare("SELECT count(*) AS count FROM memory_versions").get()).toEqual({
			count: 1,
		});
	});

	it("preserves single PATCH expected_version/If-Match and rollback to_version/If-Match", async () => {
		const { request, id } = await setup();
		const path = `/memories/${id}`;
		expect((await request(path, "PATCH", { title: "body CAS", expected_version: 1 })).status).toBe(
			200,
		);
		expect(
			(await request(path, "PATCH", { title: "header CAS" }, { "If-Match": "2" })).status,
		).toBe(200);
		const rollback = await request(
			`${path}/rollback`,
			"POST",
			{ to_version: 1 },
			{ "If-Match": "3" },
		);
		expect(rollback.status).toBe(200);
		expect(await rollback.json()).toMatchObject({ id, title: "original", version: 4 });
		expect(
			(await request(`${path}/rollback`, "POST", { to_version: 1 }, { "If-Match": "3" })).status,
		).toBe(409);
		for (const body of [{ version: 1 }, { patch: { to_version: 1 } }]) {
			const response = await request(`${path}/rollback`, "POST", body, { "If-Match": "4" });
			expect(response.status).toBe(400);
		}
	});
});
