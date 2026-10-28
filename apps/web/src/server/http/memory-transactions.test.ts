import { describe, expect, it, vi } from "vitest";
import { spyBusinessBatch } from "../../../../../tests/fixtures/business-batch";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { mintApiKey } from "../auth/api-key";
import type { Env } from "../env";
import { createApp } from "../index";
import { TagRepo } from "../repo/tags";

async function fixture() {
	const { db, sqlite } = sqliteD1();
	const key = await mintApiKey(db, "pepper", {
		name: "bot",
		role: "admin",
		ops: "r,w,u,d",
		scope: "all",
		spaceIds: [],
	});
	const app = createApp();
	const env = { DB: db, API_KEY_PEPPER: "pepper" } as Env;
	const request = (
		path = "/memories",
		method = "POST",
		body: unknown = {
			space: "kb",
			title: "title",
			body: "body",
			type: "note",
			tags: [],
		},
		idem: string | null = "create",
	) =>
		app.request(
			`/api/v1${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${key.plaintext}`,
					"Content-Type": "application/json",
					...(idem === null ? {} : { "Idempotency-Key": idem }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			env,
		);
	return { db, sqlite, request, keyId: key.row.id };
}

describe("memory HTTP transaction boundary", () => {
	it.each([
		["single", "concurrent"],
		["single", "lost-ack"],
		["batch", "concurrent"],
		["batch", "lost-ack"],
	] as const)("recovers the first owned-space %s create after %s", async (kind, mode) => {
		const { db, sqlite, request, keyId } = await fixture();
		await db
			.prepare(
				"UPDATE api_keys SET name = 'first-own', auto_own_space = 1, scope = 'own' WHERE id = ?",
			)
			.bind(keyId)
			.run();
		const item = {
			space: keyId.toLowerCase(),
			title: "title",
			body: "body",
			type: "note",
			tags: [],
		};
		const path = kind === "single" ? "/memories" : "/memories:batchCreate";
		const body = kind === "single" ? item : { items: [item] };
		if (mode === "lost-ack") {
			const batch = db.batch.bind(db);
			spyBusinessBatch(db).mockImplementationOnce(async (statements) => {
				await batch(statements);
				throw new Error("committed acknowledgment lost");
			});
		}
		const responses = await Promise.all(
			Array.from({ length: mode === "concurrent" ? 8 : 1 }, () =>
				request(path, "POST", body, "first-own"),
			),
		);
		expect(responses.map((response) => response.status)).toEqual(
			Array(responses.length).fill(kind === "single" ? 201 : 200),
		);
		expect(new Set(await Promise.all(responses.map((response) => response.text()))).size).toBe(1);
		expect(
			responses.filter((response) => response.headers.get("Idempotent-Replayed") === "true"),
		).toHaveLength(mode === "concurrent" ? 7 : 1);
		for (const table of ["memories", "idempotency_records"])
			expect(sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toMatchObject({
				count: 1,
			});
		expect(
			sqlite.prepare("SELECT count(*) AS count FROM spaces WHERE owner_key_id = ?").get(keyId),
		).toMatchObject({ count: 1 });
	});

	it.each(["single", "batch"])(
		"rejects recovered %s own-space output after ownership changes",
		async (kind) => {
			const { db, sqlite, request, keyId } = await fixture();
			await db
				.prepare(
					"UPDATE api_keys SET name = 'transferred', auto_own_space = 1, scope = 'own' WHERE id = ?",
				)
				.bind(keyId)
				.run();
			const batch = db.batch.bind(db);
			spyBusinessBatch(db).mockImplementationOnce(async (statements) => {
				await batch(statements);
				sqlite
					.prepare("UPDATE spaces SET owner_key_id = 'another-key' WHERE slug = ?")
					.run(keyId.toLowerCase());
				throw new Error("committed acknowledgment lost");
			});
			const item = {
				space: keyId.toLowerCase(),
				title: "title",
				body: "private body",
				type: "note",
				tags: [],
			};
			const response = await request(
				kind === "single" ? "/memories" : "/memories:batchCreate",
				"POST",
				kind === "single" ? item : { items: [item] },
				"transferred",
			);
			expect(response.status).toBe(kind === "single" ? 422 : 404);
			expect(await response.text()).not.toContain("private body");
		},
	);
	it("returns the one committed item to all eight concurrent same-key creates", async () => {
		const { sqlite, request } = await fixture();
		const responses = await Promise.all(Array.from({ length: 8 }, () => request()));
		expect(responses.map((response) => response.status)).toEqual(Array(8).fill(201));
		const bodies = await Promise.all(responses.map((response) => response.text()));
		expect(new Set(bodies).size).toBe(1);
		expect(
			responses.filter((response) => response.headers.get("Idempotent-Replayed") === "true"),
		).toHaveLength(7);
		for (const table of [
			"memories",
			"memory_versions",
			"memories_fts",
			"changes",
			"idempotency_records",
		])
			expect(sqlite.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(1);
	});

	it.each(["create", "patch", "rollback"])(
		"recovers a committed %s with a lost acknowledgment without a retry",
		async (operation) => {
			const { db, sqlite, request } = await fixture();
			let id: string | undefined;
			if (operation !== "create") {
				id = ((await (await request()).json()) as { id: string }).id;
			}
			const batch = db.batch.bind(db);
			const spy = spyBusinessBatch(db).mockImplementationOnce(async (statements) => {
				await batch(statements);
				throw new Error("lost committed acknowledgment");
			});
			const response =
				operation === "create"
					? await request()
					: operation === "patch"
						? await request(
								`/memories/${id}`,
								"PATCH",
								{ title: "patched", expected_version: 1 },
								"lost-ack",
							)
						: await request(
								`/memories/${id}/rollback`,
								"POST",
								{ to_version: 1, expected_version: 1 },
								"lost-ack",
							);
			expect(response.status).toBe(operation === "create" ? 201 : 200);
			expect(response.headers.get("Idempotent-Replayed")).toBe("true");
			expect(spy).toHaveBeenCalledTimes(1);
			const chunks = sqlite
				.prepare(
					"SELECT body FROM idempotency_response_chunks WHERE idem_key = ? ORDER BY chunk_index",
				)
				.all(operation === "create" ? "create" : "lost-ack") as Array<{ body: string }>;
			expect(await response.text()).toBe(chunks.map((chunk) => chunk.body).join(""));
			expect(sqlite.prepare("SELECT * FROM memories").all()).toHaveLength(1);
			expect(sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(
				operation === "create" ? 1 : 2,
			);
		},
	);

	it.each(["keyed", "unkeyed"])(
		"retains 503 when a %s write's asynchronous diagnostic DB query fails",
		async (mode) => {
			const { db, sqlite, request } = await fixture();
			const { id } = (await (await request()).json()) as { id: string };
			const prepare = db.prepare.bind(db);
			let diagnosing = false;
			vi.spyOn(db, "prepare").mockImplementation((sql) => {
				if (diagnosing && sql.startsWith("SELECT m.id, m.space_id"))
					throw new Error("private diagnostic DB failure");
				return prepare(sql);
			});
			spyBusinessBatch(db).mockImplementationOnce(async () => {
				diagnosing = true;
				throw new Error("commit failed");
			});
			const response = await request(
				`/memories/${id}`,
				"PATCH",
				{ title: "rejected", expected_version: 1 },
				mode === "keyed" ? "failed-diagnostic" : null,
			);
			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
			expect(sqlite.prepare("SELECT title, version FROM memories WHERE id = ?").get(id)).toEqual({
				title: "title",
				version: 1,
			});
			expect(sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(1);
			expect(
				sqlite
					.prepare("SELECT * FROM idempotency_records WHERE idem_key = 'failed-diagnostic'")
					.all(),
			).toEqual([]);
		},
	);

	it("rechecks the current resource after a committed write loses its acknowledgment", async () => {
		const { db, sqlite, request, keyId } = await fixture();
		const { id } = (await (await request()).json()) as { id: string };
		sqlite
			.prepare(
				"UPDATE api_keys SET scope = 'spaces', space_ids_json = '[\"space:kb\"]' WHERE id = ?",
			)
			.run(keyId);
		const batch = db.batch.bind(db);
		const spy = spyBusinessBatch(db).mockImplementationOnce(async (statements) => {
			await batch(statements);
			sqlite
				.prepare("UPDATE memories SET space_id = 'space:other', version = 3 WHERE id = ?")
				.run(id);
			throw new Error("lost committed acknowledgment");
		});
		const response = await request(
			`/memories/${id}`,
			"PATCH",
			{ body: "private committed contents", expected_version: 1 },
			"lost-scope",
		);
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain("private committed contents");
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("retains 503 if the resource lookup fails while authorizing a recovered outcome", async () => {
		const { db, sqlite, request } = await fixture();
		const { id } = (await (await request()).json()) as { id: string };
		const prepare = db.prepare.bind(db);
		let recovering = false;
		vi.spyOn(db, "prepare").mockImplementation((sql) => {
			if (recovering && sql.startsWith("SELECT m.id, m.space_id"))
				throw new Error("recovery DB failure");
			return prepare(sql);
		});
		const batch = db.batch.bind(db);
		spyBusinessBatch(db).mockImplementationOnce(async (statements) => {
			await batch(statements);
			recovering = true;
			throw new Error("lost committed acknowledgment");
		});
		const response = await request(
			`/memories/${id}`,
			"PATCH",
			{ title: "committed", expected_version: 1 },
			"failed-recovery-auth",
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
		expect(sqlite.prepare("SELECT title, version FROM memories WHERE id = ?").get(id)).toEqual({
			title: "committed",
			version: 2,
		});
	});

	it("stages an automatically owned space with the first memory", async () => {
		const { db, request, keyId } = await fixture();
		await db
			.prepare(
				"UPDATE api_keys SET name = 'new-own', auto_own_space = 1, scope = 'own' WHERE id = ?",
			)
			.bind(keyId)
			.run();
		const input = {
			space: keyId.toLowerCase(),
			title: "title",
			body: "body",
			type: "note",
			tags: ["orphan", " "],
		};
		expect((await request("/memories", "POST", input, "invalid-own")).status).toBe(400);
		expect(
			await db.prepare("SELECT * FROM spaces WHERE slug = ?").bind(keyId.toLowerCase()).first(),
		).toBeNull();
		const batch = spyBusinessBatch(db);
		const created = await request("/memories", "POST", { ...input, tags: ["valid"] }, "valid-own");
		expect(created.status).toBe(201);
		expect(batch).toHaveBeenCalledTimes(1);
		expect(
			await db
				.prepare("SELECT owner_key_id FROM spaces WHERE slug = ?")
				.bind(keyId.toLowerCase())
				.first(),
		).toEqual({ owner_key_id: keyId });
	});
	it.each(["ops", "scope", "move"])(
		"reauthorizes a saved PATCH after %s changes",
		async (change) => {
			const { db, request, keyId } = await fixture();
			const { id } = (await (await request()).json()) as { id: string };
			const patch = { body: "private body", expected_version: 1 };
			expect((await request(`/memories/${id}`, "PATCH", patch, "saved")).status).toBe(200);
			if (change === "ops")
				await db.prepare("UPDATE api_keys SET ops = 'r' WHERE id = ?").bind(keyId).run();
			if (change === "scope")
				await db
					.prepare("UPDATE api_keys SET scope = 'spaces', space_ids_json = '[]' WHERE id = ?")
					.bind(keyId)
					.run();
			if (change === "move") {
				await db
					.prepare(
						"UPDATE api_keys SET scope = 'spaces', space_ids_json = '[\"space:kb\"]' WHERE id = ?",
					)
					.bind(keyId)
					.run();
				await db
					.prepare("UPDATE memories SET space_id = 'space:other', version = 3 WHERE id = ?")
					.bind(id)
					.run();
			}
			const replay = await request(`/memories/${id}`, "PATCH", patch, "saved");
			expect(replay.status).toBe(change === "ops" ? 403 : 404);
			expect(await replay.text()).not.toContain("private body");
		},
	);

	it("does not replay a created memory that moved beyond current scope", async () => {
		const { db, request, keyId } = await fixture();
		const { id } = (await (await request()).json()) as { id: string };
		await db
			.prepare(
				"UPDATE api_keys SET scope = 'spaces', space_ids_json = '[\"space:kb\"]' WHERE id = ?",
			)
			.bind(keyId)
			.run();
		await db
			.prepare("UPDATE memories SET space_id = 'space:other', version = 2 WHERE id = ?")
			.bind(id)
			.run();
		expect((await request()).status).toBe(404);
	});
	it("does not persist newly resolved tags on rejected memory input", async () => {
		const { db, request } = await fixture();
		const response = await request("/memories", "POST", {
			space: "kb",
			title: "title",
			body: "body",
			type: "note",
			tags: ["orphan", " "],
		});
		expect(response.status).toBe(400);
		expect((await db.prepare("SELECT * FROM tags").all()).results).toEqual([]);
	});

	it("does not resurrect a merged tag when PATCH commits after the merge", async () => {
		const { db, request } = await fixture();
		const { id } = (await (
			await request("/memories", "POST", {
				space: "kb",
				title: "title",
				body: "body",
				type: "note",
				tags: ["alpha"],
			})
		).json()) as { id: string };
		const tags = new TagRepo(db);
		await tags.resolveMany(["beta"]);
		const batch = db.batch.bind(db);
		spyBusinessBatch(db).mockImplementationOnce(async (statements) => {
			await batch((await tags.merge("alpha", "beta", "admin:test")).statements);
			return batch(statements);
		});
		const response = await request(
			`/memories/${id}`,
			"PATCH",
			{ title: "rejected", expected_version: 1 },
			"merge-race",
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ error: { code: "tag_conflict" } });
		expect(
			(await db.prepare("SELECT t.name FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id").all())
				.results,
		).toEqual([{ name: "beta" }]);
		expect(
			await db.prepare("SELECT title, version FROM memories WHERE id = ?").bind(id).first(),
		).toEqual({ title: "title", version: 1 });
	});
	it("stages every mutation and replays without additional writes", async () => {
		const { db, request } = await fixture();
		const created = await request();
		const { id } = (await created.json()) as { id: string };
		for (const [path, method, body, key] of [
			[`/memories/${id}`, "PATCH", { title: "changed", expected_version: 1 }, "patch"],
			[`/memories/${id}/rollback`, "POST", { to_version: 1, expected_version: 2 }, "rollback"],
			[`/memories/${id}`, "DELETE", undefined, "trash"],
			[`/trash/${id}/restore`, "POST", {}, "restore"],
		] as const) {
			const batch = spyBusinessBatch(db);
			batch.mockClear();
			const response = await request(path, method, body, key);
			expect(response.status).toBe(200);
			const result = await response.json();
			expect(batch).toHaveBeenCalledTimes(1);
			const replay = await request(path, method, body, key);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(await replay.json()).toEqual(result);
			expect(batch).toHaveBeenCalledTimes(1);
		}
	});

	it.each(["PATCH", "DELETE"])(
		"rejects a concurrent move before %s commit atomically",
		async (method) => {
			const { db, sqlite, request } = await fixture();
			const { id } = (await (await request()).json()) as { id: string };
			const batch = db.batch.bind(db);
			spyBusinessBatch(db).mockImplementationOnce(async (statements) => {
				sqlite
					.prepare("UPDATE memories SET space_id = 'space:other', version = 2 WHERE id = ?")
					.run(id);
				return batch(statements);
			});
			const response = await request(
				`/memories/${id}`,
				method,
				{ title: "rejected", expected_version: 1 },
				"race",
			);
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({ error: { code: "version_conflict" } });
			expect(
				await db
					.prepare("SELECT title, deleted_at, version, space_id FROM memories WHERE id = ?")
					.bind(id)
					.first(),
			).toEqual({ title: "title", deleted_at: null, version: 2, space_id: "space:other" });
			expect((await db.prepare("SELECT * FROM memory_versions").all()).results).toHaveLength(1);
			expect((await db.prepare("SELECT * FROM changes").all()).results).toHaveLength(1);
			expect(
				await db.prepare("SELECT * FROM idempotency_records WHERE idem_key = 'race'").first(),
			).toBeNull();
		},
	);

	it("commits memory effects and replay outcome in the same batch", async () => {
		const { db, request } = await fixture();
		const batch = spyBusinessBatch(db);
		const response = await request();
		expect(response.status).toBe(201);
		expect(batch).toHaveBeenCalledTimes(1);
		const sql =
			batch.mock.calls[0]?.[0]
				.map((statement) => (statement as unknown as { sql: string }).sql)
				.join(";") ?? "";
		for (const table of [
			"memories",
			"memory_versions",
			"memory_tags",
			"memories_fts",
			"changes",
			"idempotency_records",
		])
			expect(sql).toContain(table);
	});

	it("rolls back memory effects when replay persistence fails", async () => {
		const { db, request } = await fixture();
		const batch = db.batch.bind(db);
		spyBusinessBatch(db).mockImplementation(async (statements) => {
			if (
				statements.some((statement) =>
					(statement as unknown as { sql: string }).sql.includes("INSERT INTO idempotency_records"),
				)
			)
				throw new Error("replay persistence failed");
			return batch(statements);
		});
		expect(
			(
				await request("/memories", "POST", {
					space: "kb",
					title: "title",
					body: "body",
					type: "note",
					tags: ["orphan"],
				})
			).status,
		).toBe(503);
		for (const table of [
			"tags",
			"memories",
			"memory_versions",
			"memory_tags",
			"memories_fts",
			"changes",
			"idempotency_records",
		]) {
			expect((await db.prepare(`SELECT * FROM ${table}`).all()).results).toEqual([]);
		}
	});
});
