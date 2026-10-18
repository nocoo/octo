import { describe, expect, it } from "vitest";
import { spyBusinessBatch } from "../../../../../../tests/fixtures/business-batch";
import { sqliteD1 } from "../../../../../../tests/fixtures/sqlite-d1";
import { mintApiKey } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";
import { createAdminParityRoutes } from "../admin/parity";

async function fixture(prefix: "/api/v1" | "/api/admin" = "/api/v1") {
	const { db, sqlite } = sqliteD1();
	sqlite.exec(
		"INSERT INTO embedding_profiles (id, model, dims, vectorize_index, created_at) VALUES ('tiny-3', 'tiny', 3, 'local', 1)",
	);
	const minted = await mintApiKey(db, "pepper", {
		name: "vector-editor",
		role: "admin",
		ops: "r,w,u,d",
		scope: "all",
		spaceIds: [],
	});
	const app = createApp();
	app.route("/api/admin", createAdminParityRoutes());
	const env = {
		DB: db,
		API_KEY_PEPPER: "pepper",
		RESOURCE_ENV: "development",
		ACCESS_DEV_BYPASS_EMAIL: "vector@local",
	} as Env;
	const headers = {
		Authorization: `Bearer ${minted.plaintext}`,
		"Content-Type": "application/json",
		Origin: "https://octo.dev.hexly.ai",
	};
	const created = await app.request(
		`${prefix}/memories`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				space: "kb",
				title: "title",
				body: "body",
				type: "note",
				tags: ["tag"],
			}),
		},
		env,
	);
	const { id } = (await created.json()) as { id: string };
	const put = (
		body: unknown = { profile: "tiny-3", values: [0, 3, 4], expected_version: 1 },
		extra: Record<string, string> = {},
	) =>
		app.request(
			`${prefix}/memories/${id}/vector`,
			{ method: "PUT", headers: { ...headers, ...extra }, body: JSON.stringify(body) },
			env,
		);
	return { db, sqlite, app, env, id, put, headers, keyId: minted.row.id };
}

describe("memory vector PUT", () => {
	it.each(["/api/v1", "/api/admin"] as const)(
		"atomically versions and normalizes vectors through %s",
		async (prefix) => {
			const { db, sqlite, id, put, keyId } = await fixture(prefix);
			const batch = spyBusinessBatch(db);
			const response = await put();
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				id,
				version: 2,
				title: "title",
				body: "body",
				tags: ["tag"],
			});
			expect(batch).toHaveBeenCalledTimes(1);
			const vector = sqlite
				.prepare("SELECT vector, indexed_at FROM memory_vectors WHERE memory_id = ?")
				.get(id) as { vector: Uint8Array; indexed_at: number | null };
			const components = new Float32Array(vector.vector.buffer, vector.vector.byteOffset, 3);
			expect([...components]).toEqual([0, expect.closeTo(0.6), expect.closeTo(0.8)]);
			expect(vector.indexed_at).toBeNull();
			expect(
				sqlite
					.prepare("SELECT actor FROM memory_versions WHERE memory_id = ? AND version = 2")
					.get(id),
			).toEqual({ actor: prefix === "/api/admin" ? "admin:vector@local" : `key:${keyId}` });
			expect(
				(await put({ profile: "tiny-3", values: [1, 0, 0] }, { "If-Match": "2" })).status,
			).toBe(200);
			expect(
				sqlite.prepare("SELECT count(*) AS total FROM memory_versions WHERE memory_id = ?").get(id),
			).toMatchObject({ total: 3 });
		},
	);

	it.each([
		[{ profile: "tiny-3", values: [1, 0, 0] }, 400],
		[{ profile: "tiny-3", values: [1, 0, 0], expected_version: 0 }, 409],
		[{ profile: "tiny-3", values: [1, 0, 0], expected_version: -1 }, 400],
		[{ profile: "tiny-3", values: [1, 0, 0], expected_version: 1.5 }, 400],
		[{ profile: "tiny-3", values: [1, 0, 0], expected_version: "1" }, 400],
		[{ profile: "tiny-3", values: "invalid", expected_version: 1 }, 400],
		[{ profile: "tiny-3", values: [], expected_version: 1 }, 400],
		[{ vector: { profile: "tiny-3", values: [1, 0, 0] }, expected_version: 1 }, 400],
		[{ profile: "tiny-3", values: [1, 0], expected_version: 1 }, 400],
		[{ profile: "tiny-3", values: [0, 0, 0], expected_version: 1 }, 400],
		[{ profile: "missing", values: [1], expected_version: 1 }, 400],
		[{ profile: "tiny-3", values: [1, 0, 0], expected_version: 7 }, 409],
		[{ profile: "tiny-3", values: [1, 0, 0], expected_version: 1, title: "rejected" }, 400],
	] as const)("rejects invalid or conflicting vector writes %#", async (body, status) => {
		const { sqlite, put } = await fixture();
		expect((await put(body)).status).toBe(status);
		expect(sqlite.prepare("SELECT * FROM memory_vectors").all()).toEqual([]);
		expect(sqlite.prepare("SELECT version FROM memories").get()).toEqual({ version: 1 });
	});

	it.each(["anonymous", "readonly", "writeonly", "hidden", "own-scope", "own-only", "trashed"])(
		"denies %s writes before vector validation",
		async (denial) => {
			const { db, sqlite, put, keyId } = await fixture();
			if (denial === "readonly")
				sqlite.prepare("UPDATE api_keys SET ops = 'r' WHERE id = ?").run(keyId);
			if (denial === "writeonly")
				sqlite.prepare("UPDATE api_keys SET ops = 'w' WHERE id = ?").run(keyId);
			if (denial === "own-scope")
				sqlite.prepare("UPDATE api_keys SET scope = 'own' WHERE id = ?").run(keyId);
			if (denial === "hidden")
				sqlite
					.prepare(
						"UPDATE api_keys SET scope = 'spaces', space_ids_json = '[\"space:other\"]' WHERE id = ?",
					)
					.run(keyId);
			if (denial === "own-only") {
				sqlite.prepare("UPDATE api_keys SET own_entries_only = 1 WHERE id = ?").run(keyId);
				sqlite.exec("UPDATE memories SET source_key_id = 'other-key'");
			}
			if (denial === "trashed") sqlite.exec("UPDATE memories SET deleted_at = 1");
			const batch = spyBusinessBatch(db);
			expect(
				(
					await put(
						{ profile: "missing", values: [0], expected_version: 1 },
						denial === "anonymous" ? { Authorization: "" } : {},
					)
				).status,
			).toBe(
				denial === "anonymous"
					? 401
					: ["readonly", "writeonly", "own-only"].includes(denial)
						? 403
						: 404,
			);
			expect(batch).not.toHaveBeenCalled();
		},
	);

	it("allows update-only vector writes but denies v1 search and batch reads without r", async () => {
		const { sqlite, put, keyId, app, env, headers } = await fixture();
		sqlite.prepare("UPDATE api_keys SET ops = 'u' WHERE id = ?").run(keyId);
		expect((await put()).status).toBe(200);
		for (const [path, body] of [
			["/search", { query: "title" }],
			["/memories:batchGet", { ids: [] }],
		] as const) {
			const response = await app.request(
				`/api/v1${path}`,
				{ method: "POST", headers, body: JSON.stringify(body) },
				env,
			);
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
		}
	});

	it.each(["/api/v1", "/api/admin"] as const)(
		"replays committed %s vectors and retains the correct principal",
		async (prefix) => {
			const { sqlite, put, keyId } = await fixture(prefix);
			const body = { profile: "tiny-3", values: [0, 3, 4], expected_version: 1 };
			const headers = { "Idempotency-Key": "vector" };
			const response = await put(body, headers);
			expect(response.status).toBe(200);
			const replay = await put(body, headers);
			expect(replay.status).toBe(200);
			expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
			expect(await replay.text()).toBe(await response.text());
			expect((await put({ ...body, values: [1, 0, 0] }, headers)).status).toBe(409);
			sqlite.prepare("UPDATE api_keys SET ops = 'r' WHERE id = ?").run(keyId);
			expect((await put(body, headers)).status).toBe(prefix === "/api/v1" ? 403 : 200);
		},
	);

	it("requires header/body versions to agree before staging", async () => {
		const { put, sqlite } = await fixture();
		for (const version of ["2", "invalid", "0"])
			expect((await put(undefined, { "If-Match": version })).status).toBe(400);
		expect(sqlite.prepare("SELECT * FROM memory_vectors").all()).toEqual([]);
	});

	it("rolls back failed commits and rejects snapshot races", async () => {
		const { db, sqlite, put } = await fixture();
		spyBusinessBatch(db).mockRejectedValueOnce(new Error("private vector commit"));
		expect((await put()).status).toBe(503);
		expect(sqlite.prepare("SELECT * FROM memory_vectors").all()).toEqual([]);
		const batch = db.batch.bind(db);
		spyBusinessBatch(db).mockImplementationOnce(async (statements) => {
			sqlite.exec("UPDATE memories SET version = 2");
			return batch(statements);
		});
		expect((await put()).status).toBe(409);
		expect(sqlite.prepare("SELECT * FROM memory_vectors").all()).toEqual([]);
		expect(sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(1);
	});
});
