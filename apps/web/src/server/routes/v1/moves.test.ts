import { describe, expect, it, vi } from "vitest";
import { mintApiKey } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";
import { insertSpace, openTestD1 } from "../../repo/__tests__/sqlite-d1";
import * as derived from "../../sync/tasks";

async function setup() {
	const db = openTestD1();
	await insertSpace(db, { id: "source", slug: "source" });
	await insertSpace(db, { id: "target", slug: "target" });
	const key = await mintApiKey(db, "pepper", {
		name: "mover",
		role: "custom",
		ops: "r,w,u,d",
		scope: "all",
	});
	const app = createApp();
	const env = { DB: db, API_KEY_PEPPER: "pepper", RESOURCE_ENV: "test" } as Env;
	const jobs: Promise<unknown>[] = [];
	const context = {
		waitUntil: (work: Promise<unknown>) => jobs.push(work),
		passThroughOnException() {},
	} as unknown as ExecutionContext;
	async function request(path: string, method = "POST", body?: unknown, extra = {}) {
		const response = await app.request(
			`/api/v1${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${key.plaintext}`,
					"content-type": "application/json",
					...extra,
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			env,
			context,
		);
		await response.clone().text();
		await Promise.all(jobs.splice(0));
		return response;
	}
	async function create() {
		const response = await request("/memories", "POST", {
			space: "source",
			title: "movable",
			body: "body",
			type: "note",
			tags: ["kept"],
		});
		expect(response.status).toBe(201);
		return (await response.json()) as { id: string };
	}
	return { db, key, request, create };
}

describe("move endpoints", () => {
	it.each(["spaces", "own"])(
		"hides unavailable targets on all-failed batch replays with %s scope",
		async (scope) => {
			const { db, key, request } = await setup();
			await db
				.prepare("UPDATE api_keys SET scope = ?, space_ids_json = '[\"source\"]' WHERE id = ?")
				.bind(scope, key.row.id)
				.run();
			await db
				.prepare("UPDATE spaces SET owner_key_id = ? WHERE id = 'source'")
				.bind(key.row.id)
				.run();
			const firstResults = [];
			const replays = [];
			for (const space of ["target", "nonexistent"]) {
				const payload = { space, items: [{ id: "missing-memory" }] };
				const headers = { "Idempotency-Key": `all-failed-${space}` };
				const first = await request("/memories:batchMove", "POST", payload, headers);
				expect(first.status).toBe(200);
				const result = await first.json();
				expect(result).toMatchObject({
					results: [{ id: "missing-memory", ok: false, error: { code: "not_found" } }],
				});
				firstResults.push(result);
				replays.push(await request("/memories:batchMove", "POST", payload, headers));
			}
			expect(firstResults[0]).toEqual(firstResults[1]);
			expect(replays.map((response) => response.status)).toEqual([404, 404]);
			for (const replay of replays) {
				expect(replay.headers.get("Idempotent-Replayed")).toBeNull();
				expect(await replay.json()).toMatchObject({
					error: { code: "not_found", message: "not found" },
				});
			}
		},
	);

	it("rolls back every memory artifact and replay record on a commit failure", async () => {
		const { db, request, create } = await setup();
		const first = await create();
		const second = await create();
		const tables = [
			"memories",
			"memory_versions",
			"memory_tags",
			"memories_fts",
			"memories_words_fts",
			"changes",
			"vector_sync_jobs",
			"idempotency_records",
		];
		const snapshot = () =>
			Promise.all(
				tables.map(async (table) => (await db.prepare(`SELECT * FROM ${table}`).all()).results),
			);
		const before = await snapshot();
		await db
			.prepare(
				"CREATE TRIGGER reject_move BEFORE INSERT ON changes WHEN NEW.op = 'moved' BEGIN SELECT RAISE(ABORT, 'test write failure'); END",
			)
			.run();
		for (const [path, body] of [
			[`/memories/${first.id}/move`, { space: "target" }],
			["/memories:batchMove", { space: "target", items: [{ id: first.id }, { id: second.id }] }],
		] as const) {
			const response = await request(path, "POST", body, { "Idempotency-Key": "failed-move" });
			expect(response.status).toBe(503);
			expect(await snapshot()).toEqual(before);
		}
	});

	it("accepts one hundred ordered items and rechecks target visibility before conflicts", async () => {
		const { db, key, request, create } = await setup();
		const { id } = await create();
		const response = await request("/memories:batchMove", "POST", {
			space: "target",
			items: Array.from({ length: 100 }, () => ({ id })),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			results: Array.from({ length: 100 }, () => ({ id, ok: true })),
		});
		await db
			.prepare("UPDATE api_keys SET scope = 'spaces', space_ids_json = '[\"target\"]' WHERE id = ?")
			.bind(key.row.id)
			.run();
		const denied = await request("/memories:batchMove", "POST", {
			space: "source",
			items: [{ id, expected_version: 0 }],
		});
		expect(await denied.json()).toMatchObject({
			results: [{ id, ok: false, error: { code: "not_found" } }],
		});
	});

	it("moves with optional OCC, replays once, audits and avoids embedding work", async () => {
		const process = vi
			.spyOn(derived, "runDerivedTasks")
			.mockResolvedValue({ synced: 0, failed: 0 });
		try {
			const { db, key, request, create } = await setup();
			const { id } = await create();
			process.mockClear();
			const headers = { "Idempotency-Key": "move-once", "If-Match": '"1"' };
			const response = await request(`/memories/${id}/move`, "POST", { space: "target" }, headers);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ id, space: "target", version: 2 });
			expect(process).toHaveBeenCalledWith(expect.anything(), undefined, [id], undefined, true);
			const replay = await request(`/memories/${id}/move`, "POST", { space: "target" }, headers);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(process).toHaveBeenCalledTimes(1);
			expect(
				await db
					.prepare("SELECT actor, status FROM audit_log WHERE route = '/api/v1/memories/:id/move'")
					.first(),
			).toEqual({ actor: `key:${key.row.id}`, status: 200 });
			await db
				.prepare(
					"UPDATE api_keys SET scope = 'spaces', space_ids_json = '[\"source\"]' WHERE id = ?",
				)
				.bind(key.row.id)
				.run();
			expect(
				(await request(`/memories/${id}/move`, "POST", { space: "target" }, headers)).status,
			).toBe(404);
			expect((await request(`/memories/${id}`, "GET")).status).toBe(404);
		} finally {
			process.mockRestore();
		}
	});
	it("returns ordered per-item results including duplicates and rolls back failed items", async () => {
		const { db, key, request, create } = await setup();
		const first = await create();
		const second = await create();
		const payload = {
			space: "target",
			items: [
				{ id: first.id },
				{ id: "missing" },
				{ id: second.id, expected_version: 0 },
				{ id: first.id, expected_version: 1 },
				{ id: first.id },
				{ id: second.id, expected_version: 1 },
			],
		};
		const headers = { "Idempotency-Key": "batch-once" };
		const response = await request("/memories:batchMove", "POST", payload, headers);
		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result).toEqual({
			results: [
				{ id: first.id, ok: true },
				{ id: "missing", ok: false, error: expect.objectContaining({ code: "not_found" }) },
				{ id: second.id, ok: false, error: expect.objectContaining({ code: "version_conflict" }) },
				{ id: first.id, ok: false, error: expect.objectContaining({ code: "version_conflict" }) },
				{ id: first.id, ok: true },
				{ id: second.id, ok: true },
			],
		});
		const replay = await request("/memories:batchMove", "POST", payload, headers);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.json()).toEqual(result);
		expect(await db.prepare("SELECT COUNT(*) AS count FROM memory_versions").first()).toEqual({
			count: 4,
		});
		await db.prepare("UPDATE api_keys SET ops = 'r' WHERE id = ?").bind(key.row.id).run();
		expect((await request("/memories:batchMove", "POST", payload, headers)).status).toBe(403);
	});
	it("validates bounds and optional versions and hides trashed memories", async () => {
		const { request, create } = await setup();
		const { id } = await create();
		for (const body of [
			{},
			{ space: "target", items: [] },
			{ space: "target", items: [{ id, extra: true }] },
			{ space: "target", items: [{ id, expected_version: -1 }] },
		])
			expect((await request("/memories:batchMove", "POST", body)).status).toBe(400);
		expect(
			(
				await request("/memories:batchMove", "POST", {
					space: "target",
					items: Array.from({ length: 101 }, () => ({ id })),
				})
			).status,
		).toBe(413);
		expect(
			(await request(`/memories/${id}/move`, "POST", { space: "target", title: "invalid" })).status,
		).toBe(400);
		expect(
			(await request(`/memories/${id}/move`, "POST", { space: "target" }, { "If-Match": "bad" }))
				.status,
		).toBe(400);
		expect(
			(await request(`/memories/${id}/move`, "POST", { space: "target" }, { "If-Match": "0" }))
				.status,
		).toBe(409);
		await request(`/memories/${id}`, "DELETE");
		expect((await request(`/memories/${id}/move`, "POST", { space: "target" })).status).toBe(404);
	});
});
