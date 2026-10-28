import { afterEach, describe, expect, it, vi } from "vitest";
import { spyBusinessBatch } from "../../../../../tests/fixtures/business-batch";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { mintApiKey } from "../auth/api-key";
import type { Env } from "../env";
import { createApp } from "../index";

const input = {
	space: "kb",
	title: "first",
	body: "searchable body",
	type: "note",
	tags: ["Shared"],
};
const databases: Array<ReturnType<typeof sqliteD1>["sqlite"]> = [];

afterEach(() => {
	vi.restoreAllMocks();
	for (const db of databases.splice(0)) db.close();
});

async function fixture(ops = "r,w,u,d", autoOwnSpace = false) {
	const { db, sqlite } = sqliteD1();
	databases.push(sqlite);
	const key = await mintApiKey(db, "pepper", {
		name: "batch-bot",
		role: "custom",
		ops,
		scope: autoOwnSpace ? "own" : "all",
		spaceIds: [],
		autoOwnSpace,
	});
	const env = { DB: db, API_KEY_PEPPER: "pepper" } as Env;
	const app = createApp();
	const post = (
		action: string,
		body: unknown,
		idem?: string,
		token: string | null = key.plaintext,
	) =>
		app.request(
			`/api/v1/memories:batch${action}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token === null ? {} : { Authorization: `Bearer ${token}` }),
					...(idem ? { "Idempotency-Key": idem } : {}),
				},
				body: JSON.stringify(body),
			},
			env,
		);
	return { db, sqlite, post, key, app, env };
}

type BatchBody = {
	results: Array<{
		ok: boolean;
		item?: { id: string; title: string; version: number; tags: string[]; trashed_at?: string };
		error?: { code: string; details?: unknown };
	}>;
};

async function create(scenario: Awaited<ReturnType<typeof fixture>>) {
	const response = await scenario.post("Create", { items: [input] });
	expect(response.status).toBe(200);
	const body = (await response.json()) as BatchBody;
	expect(body.results[0]).toMatchObject({ ok: true, item: { version: 1, tags: ["shared"] } });
	const id = body.results[0]?.item?.id;
	if (!id) throw new Error("missing created ID");
	return id;
}

describe("production batch HTTP transactions", () => {
	it.each(["Update", "Delete"])(
		"recovers a committed batch%s with a lost acknowledgment without rereading the consumed body",
		async (action) => {
			const scenario = await fixture();
			const id = await create(scenario);
			const batch = scenario.db.batch.bind(scenario.db);
			const spy = spyBusinessBatch(scenario.db).mockImplementationOnce(async (statements) => {
				await batch(statements);
				throw new Error("lost committed acknowledgment");
			});
			const response = await scenario.post(
				action,
				action === "Update"
					? { items: [{ id, title: "committed", expected_version: 1 }] }
					: { ids: [id] },
				"lost-ack",
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("Idempotent-Replayed")).toBe("true");
			expect(spy).toHaveBeenCalledTimes(1);
			const chunks = scenario.sqlite
				.prepare(
					"SELECT body FROM idempotency_response_chunks WHERE idem_key = 'lost-ack' ORDER BY chunk_index",
				)
				.all() as Array<{ body: string }>;
			expect(await response.text()).toBe(chunks.map((chunk) => chunk.body).join(""));
			expect(scenario.sqlite.prepare("SELECT * FROM changes").all()).toHaveLength(2);
			expect(scenario.sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(
				action === "Update" ? 2 : 1,
			);
		},
	);

	it("accepts and recovers a valid 100-item update envelope larger than the single-memory JSON cap", async () => {
		const scenario = await fixture();
		const created = await scenario.post("Create", {
			items: Array.from({ length: 100 }, () => ({ ...input, tags: [] })),
		});
		expect(created.status).toBe(200);
		const initial = (await created.json()) as BatchBody;
		expect(initial.results.every((result) => result.ok)).toBe(true);
		const payload = {
			items: initial.results.map((result) => ({
				id: result.item?.id,
				body: "x".repeat(65_000),
				expected_version: 1,
			})),
		};
		expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeGreaterThan(6_100_000);
		const batch = scenario.db.batch.bind(scenario.db);
		const spy = spyBusinessBatch(scenario.db).mockImplementationOnce(async (statements) => {
			await batch(statements);
			throw new Error("lost committed acknowledgment");
		});
		const response = await scenario.post("Update", payload, "large-lost-ack");
		expect(response.status).toBe(200);
		expect(response.headers.get("Idempotent-Replayed")).toBe("true");
		const body = (await response.json()) as BatchBody;
		expect(body.results).toHaveLength(100);
		expect(body.results.every((result) => result.ok && result.item?.version === 2)).toBe(true);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(
			scenario.sqlite
				.prepare("SELECT count(*) AS n FROM memories WHERE version = 2 AND length(body) = 65000")
				.get(),
		).toEqual({ n: 100 });
		expect(scenario.sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(200);
	});

	it("stages lazy own-space creation, rolls back failed items and reuses the successful space", async () => {
		const scenario = await fixture("w", true);
		const own = { ...input, space: scenario.key.row.id.toLowerCase() };
		const response = await scenario.post(
			"Create",
			{
				items: [
					{ ...own, tags: ["Discarded"], vector: { profile: "missing", values: [1] } },
					own,
					{ ...own, title: "second" },
				],
			},
			"auto-own",
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			results: [
				{ ok: false, error: { code: "validation_failed" } },
				{ ok: true, item: { space: scenario.key.row.id.toLowerCase(), version: 1 } },
				{ ok: true, item: { space: scenario.key.row.id.toLowerCase(), version: 1 } },
			],
		});
		expect(
			scenario.sqlite
				.prepare("SELECT slug, owner_key_id FROM spaces WHERE owner_key_id = ?")
				.all(scenario.key.row.id),
		).toEqual([{ slug: scenario.key.row.id.toLowerCase(), owner_key_id: scenario.key.row.id }]);
		expect(scenario.sqlite.prepare("SELECT * FROM memories").all()).toHaveLength(2);
		expect(scenario.sqlite.prepare("SELECT name FROM tags").all()).toEqual([{ name: "shared" }]);
	});

	it("does not persist a lazily created own space when the HTTP transaction fails", async () => {
		const scenario = await fixture("w", true);
		const batch = spyBusinessBatch(scenario.db);
		scenario.sqlite.exec(
			"CREATE TRIGGER fail_replay BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT, 'response failure'); END",
		);
		const response = await scenario.post(
			"Create",
			{ items: [{ ...input, space: scenario.key.row.id.toLowerCase() }] },
			"auto-own-fail",
		);
		expect(response.status).toBe(503);
		expect(batch).toHaveBeenCalledTimes(1);
		const sql = batch.mock.calls[0]?.[0]
			.map((statement) => (statement as unknown as { sql: string }).sql)
			.join(";");
		for (const table of [
			"spaces",
			"memories",
			"tags",
			"memory_versions",
			"idempotency_response_chunks",
		])
			expect(sql).toContain(`INTO ${table}`);
		for (const table of ["memories", "memory_versions", "tags", "changes", "idempotency_records"])
			expect(scenario.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
		expect(
			scenario.sqlite
				.prepare("SELECT * FROM spaces WHERE owner_key_id = ?")
				.all(scenario.key.row.id),
		).toEqual([]);
	});

	it("allows write/update/delete-only keys without requiring read permission", async () => {
		const scenario = await fixture("w,u,d");
		const id = await create(scenario);
		const update = await scenario.post("Update", {
			items: [{ id, title: "updated", expected_version: 1 }],
		});
		expect(update.status).toBe(200);
		expect(await update.json()).toMatchObject({ results: [{ ok: true, item: { version: 2 } }] });
		const deleted = await scenario.post("Delete", { ids: [id] }, "delete-only");
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toMatchObject({ results: [{ ok: true }] });
		const replay = await scenario.post("Delete", { ids: [id] }, "delete-only");
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
	});

	it("reauthorizes only successful items, preserving a legitimate partially failed replay", async () => {
		const scenario = await fixture();
		const payload = { items: [{ ...input, space: "missing" }, input] };
		const first = await scenario.post("Create", payload, "partial");
		expect(first.status).toBe(200);
		const body = (await first.json()) as BatchBody;
		expect(body.results.map((result) => result.ok)).toEqual([false, true]);
		const replay = await scenario.post("Create", payload, "partial");
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.json()).toEqual(body);
	});

	it("rejects a cached foreign snapshot when the current row becomes owned", async () => {
		const scenario = await fixture();
		const id = await create(scenario);
		scenario.sqlite.prepare("UPDATE memories SET source_key_id = 'foreign' WHERE id = ?").run(id);
		const payload = { items: [{ id, title: "cached", expected_version: 1 }] };
		expect((await scenario.post("Update", payload, "snapshot-owner")).status).toBe(200);
		scenario.sqlite
			.prepare("UPDATE memories SET source_key_id = ? WHERE id = ?")
			.run(scenario.key.row.id, id);
		scenario.sqlite
			.prepare("UPDATE api_keys SET own_entries_only = 1 WHERE id = ?")
			.run(scenario.key.row.id);
		expect((await scenario.post("Update", payload, "snapshot-owner")).status).toBe(403);
	});

	it("does not replay cached conflict details after the memory leaves scope", async () => {
		const scenario = await fixture();
		const id = await create(scenario);
		const payload = { items: [{ id, title: "stale", expected_version: 99 }] };
		const first = await scenario.post("Update", payload, "conflict-replay");
		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({
			results: [
				{ ok: false, error: { code: "version_conflict", details: { current_version: 1 } } },
			],
		});
		scenario.sqlite
			.prepare("UPDATE api_keys SET scope = 'spaces', space_ids_json = '[]' WHERE id = ?")
			.run(scenario.key.row.id);
		const replay = await scenario.post("Update", payload, "conflict-replay");
		expect(replay.status).toBe(404);
		expect(await replay.json()).toMatchObject({ error: { code: "not_found" } });
	});

	it.each(["Create", "Update"])(
		"does not replay cached %s contents after trash",
		async (action) => {
			const scenario = await fixture();
			const existing = action === "Create" ? undefined : await create(scenario);
			const payload =
				action === "Create"
					? { items: [input] }
					: { items: [{ id: existing, title: "cached", expected_version: 1 }] };
			const first = await scenario.post(action, payload, "trashed-replay");
			expect(first.status).toBe(200);
			const body = (await first.json()) as BatchBody;
			const id = body.results[0]?.item?.id;
			expect((await scenario.post("Delete", { ids: [id] })).status).toBe(200);
			const replay = await scenario.post(action, payload, "trashed-replay");
			expect(replay.status).toBe(404);
			expect(await replay.json()).toMatchObject({ error: { code: "not_found" } });
		},
	);

	it.each(["Create", "Update", "Delete"])(
		"reauthorizes cached %s successes after losing the operation",
		async (action) => {
			const scenario = await fixture();
			const id = action === "Create" ? undefined : await create(scenario);
			const payload =
				action === "Create"
					? { items: [input] }
					: action === "Update"
						? { items: [{ id, title: "cached", expected_version: 1 }] }
						: { ids: [id] };
			const original = await scenario.post(action, payload, "operation-replay");
			expect(original.status).toBe(200);
			expect(await original.json()).toMatchObject({ results: [{ ok: true }] });
			scenario.sqlite
				.prepare("UPDATE api_keys SET ops = 'r' WHERE id = ?")
				.run(scenario.key.row.id);
			const replay = await scenario.post(action, payload, "operation-replay");
			expect(replay.status).toBe(403);
			expect(await replay.json()).toMatchObject({ error: { code: "forbidden" } });
			expect(replay.headers.get("Idempotent-Replayed")).toBeNull();
		},
	);

	it.each(["Create", "Update", "Delete"])(
		"hides cached %s successes after losing space visibility",
		async (action) => {
			const scenario = await fixture();
			const id = action === "Create" ? undefined : await create(scenario);
			const payload =
				action === "Create"
					? { items: [input] }
					: action === "Update"
						? { items: [{ id, title: "cached", expected_version: 1 }] }
						: { ids: [id] };
			expect((await scenario.post(action, payload, "scope-replay")).status).toBe(200);
			scenario.sqlite
				.prepare("UPDATE api_keys SET scope = 'spaces', space_ids_json = '[]' WHERE id = ?")
				.run(scenario.key.row.id);
			const replay = await scenario.post(action, payload, "scope-replay");
			expect(replay.status).toBe(404);
			expect(await replay.json()).toMatchObject({ error: { code: "not_found" } });
			expect(replay.headers.get("Idempotent-Replayed")).toBeNull();
		},
	);

	it.each(["Update", "Delete"])(
		"rechecks own-entry constraints before replaying %s",
		async (action) => {
			const scenario = await fixture();
			const id = await create(scenario);
			scenario.sqlite
				.prepare("UPDATE memories SET source_key_id = 'another-key' WHERE id = ?")
				.run(id);
			const payload =
				action === "Update"
					? { items: [{ id, title: "cached", expected_version: 1 }] }
					: { ids: [id] };
			expect((await scenario.post(action, payload, "ownership-replay")).status).toBe(200);
			scenario.sqlite
				.prepare("UPDATE api_keys SET own_entries_only = 1 WHERE id = ?")
				.run(scenario.key.row.id);
			const replay = await scenario.post(action, payload, "ownership-replay");
			expect(replay.status).toBe(403);
			expect(await replay.json()).toMatchObject({ error: { code: "forbidden" } });
		},
	);

	it("checks the cached snapshot's space even when the current memory has moved into scope", async () => {
		const scenario = await fixture();
		const original = await scenario.post("Create", { items: [input] }, "snapshot-replay");
		expect(original.status).toBe(200);
		const body = (await original.json()) as BatchBody;
		const id = body.results[0]?.item?.id;
		scenario.sqlite
			.prepare("UPDATE memories SET space_id = 'space:dest' WHERE id = ?")
			.run(id ?? "");
		scenario.sqlite
			.prepare(
				"UPDATE api_keys SET scope = 'spaces', space_ids_json = '[\"space:dest\"]' WHERE id = ?",
			)
			.run(scenario.key.row.id);
		const replay = await scenario.post("Create", { items: [input] }, "snapshot-replay");
		expect(replay.status).toBe(404);
		expect(await replay.json()).toMatchObject({ error: { code: "not_found" } });
	});

	it("commits real memory, version, tag, FTS, change and replay effects together", async () => {
		const scenario = await fixture();
		const batch = spyBusinessBatch(scenario.db);
		const response = await scenario.post(
			"Create",
			{ items: [input, { ...input, title: "second" }] },
			"create",
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as BatchBody;
		expect(body.results.map((result) => result.ok)).toEqual([true, true]);
		expect(batch).toHaveBeenCalledTimes(1);
		for (const table of [
			"memories",
			"memory_versions",
			"memory_tags",
			"memories_fts",
			"memories_fts_map",
			"changes",
		])
			expect(scenario.sqlite.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(2);
		expect(scenario.sqlite.prepare("SELECT name FROM tags").all()).toEqual([{ name: "shared" }]);
		expect(
			scenario.sqlite
				.prepare(
					"SELECT memory_id FROM memories_fts_map WHERE fts_rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'searchable')",
				)
				.all(),
		).toHaveLength(2);
		const replay = await scenario.post(
			"Create",
			{ items: [input, { ...input, title: "second" }] },
			"create",
		);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.json()).toEqual(body);
		expect(batch).toHaveBeenCalledTimes(1);
		const id = body.results[0]?.item?.id;
		const read = await scenario.app.request(
			`/api/v1/memories/${id}?include=versions_count`,
			{ headers: { Authorization: `Bearer ${scenario.key.plaintext}` } },
			scenario.env,
		);
		expect(read.status).toBe(200);
		expect(await read.json()).toMatchObject({ id, tags: ["shared"], versions_count: 1 });
	});

	it("reads staged versions, fields, tags and moved spaces for repeated IDs", async () => {
		const scenario = await fixture();
		const id = await create(scenario);
		const response = await scenario.post(
			"Update",
			{
				items: [
					{ id, title: "second", tags: ["New"], space: "dest", expected_version: 1 },
					{ id, body: "changed body", expected_version: 2 },
					{ id, title: "stale", expected_version: 1 },
					{ id, importance: 0.9, expected_version: 3 },
				],
			},
			"update",
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as BatchBody;
		expect(body.results.map((result) => result.ok)).toEqual([true, true, false, true]);
		expect(body.results[2]).toMatchObject({
			error: { code: "version_conflict", details: { current_version: 3 } },
		});
		expect(body.results[3]?.item).toMatchObject({
			title: "second",
			body: "changed body",
			space: "dest",
			tags: ["new"],
			version: 4,
		});
		expect(
			scenario.sqlite
				.prepare("SELECT title, body, version, space_id FROM memories WHERE id = ?")
				.get(id),
		).toEqual({ title: "second", body: "changed body", version: 4, space_id: "space:dest" });
		expect(
			scenario.sqlite
				.prepare("SELECT version, tags_json FROM memory_versions ORDER BY version")
				.all(),
		).toEqual([
			{ version: 1, tags_json: '["shared"]' },
			{ version: 2, tags_json: '["new"]' },
			{ version: 3, tags_json: '["new"]' },
			{ version: 4, tags_json: '["new"]' },
		]);
		expect(scenario.sqlite.prepare("SELECT op FROM changes ORDER BY seq").all()).toEqual(
			["created", "moved_out", "moved", "updated", "updated"].map((op) => ({ op })),
		);
		expect(
			scenario.sqlite
				.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'changed'")
				.all(),
		).toHaveLength(1);
		expect(
			scenario.sqlite
				.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'searchable'")
				.all(),
		).toHaveLength(0);
	});

	it("trashes each ID once and removes its real FTS entry without deleting history", async () => {
		const scenario = await fixture();
		const id = await create(scenario);
		const response = await scenario.post("Delete", { ids: [id, id, "missing"] }, "delete");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			results: [
				{ ok: true, item: { trashed_at: expect.any(String) } },
				{ ok: false, error: { code: "not_found" } },
				{ ok: false, error: { code: "not_found" } },
			],
		});
		expect(
			scenario.sqlite.prepare("SELECT deleted_at FROM memories WHERE id = ?").get(id),
		).toMatchObject({
			deleted_at: expect.any(Number),
		});
		expect(scenario.sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(1);
		expect(scenario.sqlite.prepare("SELECT * FROM memory_tags").all()).toHaveLength(1);
		expect(scenario.sqlite.prepare("SELECT * FROM memories_fts").all()).toHaveLength(0);
		expect(scenario.sqlite.prepare("SELECT op FROM changes ORDER BY seq").all()).toEqual([
			{ op: "created" },
			{ op: "trashed" },
		]);
	});

	it("rolls back a failed item's staged tag and memory state before the next item", async () => {
		const scenario = await fixture();
		const id = await create(scenario);
		const response = await scenario.post("Update", {
			items: [
				{
					id,
					title: "rejected",
					tags: ["Failed"],
					vector: { profile: "missing", values: [1] },
					expected_version: 1,
				},
				{ id, title: "accepted", expected_version: 1 },
			],
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			results: [
				{ ok: false, error: { code: "validation_failed" } },
				{ ok: true, item: { title: "accepted", version: 2, tags: ["shared"] } },
			],
		});
		expect(scenario.sqlite.prepare("SELECT name FROM tags ORDER BY name").all()).toEqual([
			{ name: "shared" },
		]);
		expect(scenario.sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(2);
		expect(scenario.sqlite.prepare("SELECT * FROM changes").all()).toHaveLength(2);
	});

	it("does not misclassify a replay-storage failure after sequential updates as a version conflict", async () => {
		const scenario = await fixture();
		const id = await create(scenario);
		scenario.sqlite.exec(
			"CREATE TRIGGER fail_replay BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT, 'response failure'); END",
		);
		const response = await scenario.post(
			"Update",
			{
				items: [
					{ id, title: "second", tags: ["Transient"], expected_version: 1 },
					{ id, title: "third", expected_version: 2 },
				],
			},
			"failed-update",
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
		expect(
			scenario.sqlite.prepare("SELECT title, version FROM memories WHERE id = ?").get(id),
		).toEqual({
			title: "first",
			version: 1,
		});
		expect(scenario.sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(1);
		expect(scenario.sqlite.prepare("SELECT name FROM tags").all()).toEqual([{ name: "shared" }]);
		expect(scenario.sqlite.prepare("SELECT * FROM changes").all()).toHaveLength(1);
		expect(
			scenario.sqlite
				.prepare("SELECT * FROM idempotency_records WHERE idem_key = 'failed-update'")
				.all(),
		).toEqual([]);
	});

	it("maps a commit race against persisted state rather than the final predicted version", async () => {
		const scenario = await fixture();
		const id = await create(scenario);
		const batch = scenario.db.batch.bind(scenario.db);
		spyBusinessBatch(scenario.db).mockImplementationOnce(async (statements) => {
			scenario.sqlite
				.prepare("UPDATE memories SET title = 'concurrent', version = 2 WHERE id = ?")
				.run(id);
			return batch(statements);
		});
		const response = await scenario.post(
			"Update",
			{
				items: [
					{ id, title: "rejected", tags: ["Transient"], expected_version: 1 },
					{ id, title: "also rejected", expected_version: 2 },
				],
			},
			"race",
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: { code: "version_conflict", details: { current_version: 2 } },
		});
		expect(
			scenario.sqlite.prepare("SELECT title, version FROM memories WHERE id = ?").get(id),
		).toEqual({
			title: "concurrent",
			version: 2,
		});
		expect(scenario.sqlite.prepare("SELECT name FROM tags").all()).toEqual([{ name: "shared" }]);
		expect(scenario.sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(1);
		expect(scenario.sqlite.prepare("SELECT * FROM changes").all()).toHaveLength(1);
		expect(
			scenario.sqlite.prepare("SELECT * FROM idempotency_records WHERE idem_key = 'race'").all(),
		).toEqual([]);
	});

	it.each(["Create", "Update", "Delete"])(
		"enforces production %s auth and validation without writes",
		async (action) => {
			const scenario = await fixture("r");
			const body =
				action === "Create"
					? { items: [input] }
					: action === "Update"
						? { items: [{ id: "missing", title: "t", expected_version: 1 }] }
						: { ids: ["missing"] };
			for (const token of [null, "octo_invalid"])
				expect((await scenario.post(action, body, undefined, token)).status).toBe(401);
			expect((await scenario.post(action, { unknown: true })).status).toBe(400);
			const response = await scenario.post(action, body);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				results: [{ ok: false, error: { code: action === "Create" ? "forbidden" : "not_found" } }],
			});
			for (const table of [
				"memories",
				"memory_versions",
				"memory_tags",
				"tags",
				"memories_fts",
				"changes",
			])
				expect(scenario.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
		},
	);
});
