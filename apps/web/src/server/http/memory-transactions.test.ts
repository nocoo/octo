import { describe, expect, it, vi } from "vitest";
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
		idem = "create",
	) =>
		app.request(
			`/api/v1${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${key.plaintext}`,
					"Content-Type": "application/json",
					"Idempotency-Key": idem,
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			env,
		);
	return { db, sqlite, request, keyId: key.row.id };
}

describe("memory HTTP transaction boundary", () => {
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
		vi.spyOn(db, "batch").mockImplementationOnce(async (statements) => {
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
			const batch = vi.spyOn(db, "batch");
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
			vi.spyOn(db, "batch").mockImplementationOnce(async (statements) => {
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
		const batch = vi.spyOn(db, "batch");
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
		vi.spyOn(db, "batch").mockImplementation(async (statements) => {
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
