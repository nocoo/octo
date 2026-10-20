import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateApiKeyMaterial, hashSecret, mintApiKey } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";
import { asD1, FakeD1, type KeyRec } from "../../repo/__tests__/fake-d1";
import { migratedSqlite } from "../../repo/__tests__/sqlite-d1";
import { spacesRoutes } from "./spaces";

const PEPPER = "change-me-api-key-pepper";

function envFor(db: FakeD1): Env {
	return {
		DB: asD1(db),
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: PEPPER,
	};
}

async function seedKey(
	db: FakeD1,
	over: Partial<KeyRec> = {},
): Promise<{ token: string; id: string }> {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret(PEPPER, material.secret);
	const row: KeyRec = {
		id: material.keyid,
		name: "reader",
		secret_hash: secretHash,
		prev_secret_hash: null,
		prev_valid_until: null,
		role: "project",
		ops: "r",
		scope: "spaces",
		space_ids_json: '["s1"]',
		own_entries_only: 0,
		auto_own_space: 0,
		expires_at: null,
		revoked_at: null,
		last_used_at: null,
		created_at: 1,
		updated_at: 1,
		...over,
	};
	row.id = material.keyid;
	row.secret_hash = secretHash;
	db.keys.set(row.id, row);
	return { token: material.plaintext, id: row.id };
}

describe("spaces routes", () => {
	it("lists and gets visible spaces only", async () => {
		const db = new FakeD1();
		const seeded = await seedKey(db);
		db.spaces.set("s1", {
			id: "s1",
			slug: "kb-bot",
			name: "kb",
			description: "",
			owner_key_id: seeded.id,
			created_at: 1,
			updated_at: 1,
		});
		db.spaces.set("s2", {
			id: "s2",
			slug: "secret",
			name: "secret",
			description: "",
			owner_key_id: null,
			created_at: 1,
			updated_at: 1,
		});
		const headers = { Authorization: `Bearer ${seeded.token}` };
		const app = createApp();
		const listed = await app.request("/api/v1/spaces", { headers }, envFor(db));
		expect(listed.status).toBe(200);
		const body = (await listed.json()) as {
			items: Array<{ slug: string; created_at: string }>;
			next_cursor: string | null;
		};
		expect(body.next_cursor).toBeNull();
		expect(body.items.map((s) => s.slug)).toEqual(["kb-bot"]);
		expect(body.items[0]?.created_at).toBe("1970-01-01T00:00:00.001Z");
		const one = await app.request("/api/v1/spaces/kb-bot", { headers }, envFor(db));
		expect(one.status).toBe(200);
		const hidden = await app.request("/api/v1/spaces/secret", { headers }, envFor(db));
		expect(hidden.status).toBe(404);
		const writeOnly = await seedKey(db, { ops: "w", space_ids_json: '["s1"]' });
		const denied = await app.request(
			"/api/v1/spaces",
			{ headers: { Authorization: `Bearer ${writeOnly.token}` } },
			envFor(db),
		);
		expect(denied.status).toBe(403);
	});

	it("lists 101 spaces for an all-scope key", async () => {
		const db = new FakeD1();
		const admin = await seedKey(db, {
			role: "admin",
			ops: "r",
			scope: "all",
			space_ids_json: "[]",
		});
		for (let i = 0; i < 101; i++) {
			const id = `sp${i}`;
			db.spaces.set(id, {
				id,
				slug: id,
				name: id,
				description: "",
				owner_key_id: null,
				created_at: 1,
				updated_at: 1,
			});
		}
		const listed = await createApp().request(
			"/api/v1/spaces",
			{ headers: { Authorization: `Bearer ${admin.token}` } },
			envFor(db),
		);
		expect(listed.status).toBe(200);
		const body = (await listed.json()) as { items: unknown[] };
		expect(body.items).toHaveLength(101);
	});

	it("returns 401 without authz on the sub-app", async () => {
		const res = await spacesRoutes().request("/missing", {}, envFor(new FakeD1()));
		expect([401, 500]).toContain(res.status);
	});
});

describe("space management with API keys", () => {
	let store: ReturnType<typeof migratedSqlite>;
	let app: ReturnType<typeof createApp>;
	let token: string;
	let keyId: string;
	let tasks: Promise<unknown>[];
	beforeEach(async () => {
		store = migratedSqlite();
		store.raw.exec("PRAGMA foreign_keys = ON");
		app = createApp();
		tasks = [];
		const key = await mintApiKey(store.d1, PEPPER, {
			name: "space-admin",
			role: "admin",
			ops: "r,w,u,d",
			scope: "all",
		});
		token = key.plaintext;
		keyId = key.row.id;
	});
	afterEach(async () => {
		await Promise.all(tasks);
		store.raw.close();
		vi.restoreAllMocks();
	});
	async function request(method: string, path = "", body?: unknown, idem?: string, auth = token) {
		const response = await app.request(
			`/api/v1/spaces${path}`,
			{
				method,
				headers: {
					...(auth ? { Authorization: `Bearer ${auth}` } : {}),
					...(idem === undefined ? {} : { "Idempotency-Key": idem }),
				},
				...(body === undefined
					? {}
					: { body: typeof body === "string" ? body : JSON.stringify(body) }),
			},
			{ DB: store.d1, API_KEY_PEPPER: PEPPER } as Env,
			{
				waitUntil(task: Promise<unknown>) {
					tasks.push(task);
				},
			} as ExecutionContext,
		);
		await Promise.all(tasks);
		return response;
	}
	const input = { slug: "managed", name: "Managed" };
	it("creates, renames and deletes with a stable slug, key actor and idempotent outcomes", async () => {
		const created = await request("POST", "", input, "create");
		expect(created.status).toBe(201);
		const row = (await created.json()) as { id: string };
		expect(row).toMatchObject({ ...input, description: "", owner_key_id: null, memory_count: 0 });
		const replay = await request("POST", "", input, "create");
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.json()).toEqual(row);
		expect((await request("POST", "", { ...input, name: "Other" }, "create")).status).toBe(409);
		const updated = await request(
			"PATCH",
			"/managed",
			{ name: "Renamed", description: "New" },
			"update",
		);
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			id: row.id,
			slug: "managed",
			name: "Renamed",
			description: "New",
		});
		expect(
			(
				await request("PATCH", "/managed", { name: "Renamed", description: "New" }, "update")
			).headers.get("Idempotent-Replayed"),
		).toBe("true");
		const deleted = await request("DELETE", "/managed", undefined, "delete");
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ id: row.id, slug: "managed", deleted: true });
		expect(
			(await request("DELETE", "/managed", undefined, "delete")).headers.get("Idempotent-Replayed"),
		).toBe("true");
		expect(store.raw.prepare("SELECT op, actor FROM changes ORDER BY seq").all()).toEqual([
			{ op: "created", actor: `key:${keyId}` },
			{ op: "updated", actor: `key:${keyId}` },
			{ op: "deleted", actor: `key:${keyId}` },
		]);
		expect(store.raw.prepare("SELECT DISTINCT actor FROM audit_log").all()).toEqual([
			{ actor: `key:${keyId}` },
		]);
	});
	it("requires admin role before body parsing or idempotent replay", async () => {
		expect((await request("POST", "", input, "saved")).status).toBe(201);
		expect((await request("PATCH", "/managed", { name: "New" }, "saved-patch")).status).toBe(200);
		expect((await request("DELETE", "/managed", undefined, "saved-delete")).status).toBe(200);
		for (const role of ["project", "readonly", "drop", "custom"]) {
			store.raw.prepare("UPDATE api_keys SET role = ? WHERE id = ?").run(role, keyId);
			for (const [method, path] of [
				["POST", ""],
				["PATCH", "/managed"],
				["DELETE", "/managed"],
			]) {
				const denied = await request(method ?? "", path, "{", "x".repeat(129));
				expect(denied.status).toBe(403);
				expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
			}
			const denied = await request("POST", "", input, "saved");
			expect(denied.status).toBe(403);
			expect(denied.headers.get("Idempotent-Replayed")).toBeNull();
			for (const [method, body, idem] of [
				["PATCH", { name: "New" }, "saved-patch"],
				["DELETE", undefined, "saved-delete"],
			] as const) {
				const replay = await request(method, "/managed", body, idem);
				expect(replay.status).toBe(403);
				expect(replay.headers.get("Idempotent-Replayed")).toBeNull();
			}
		}
		for (const method of ["POST", "PATCH", "DELETE"]) {
			expect(
				(await request(method, method === "POST" ? "" : "/managed", "{", undefined, "")).status,
			).toBe(401);
		}
	});
	it("rejects immutable slugs, owner management, unknown fields and empty updates", async () => {
		expect((await request("POST", "", input)).status).toBe(201);
		for (const body of [
			{ slug: "Invalid Slug" },
			{ owner_key_id: null },
			{ unexpected: true },
			{},
			{ name: " " },
			{ description: null },
		]) {
			expect((await request("PATCH", "/managed", body)).status).toBe(400);
		}
		for (const body of [
			{ owner_key_id: null },
			{ unexpected: true },
			{ slug: "Bad Slug" },
			{ slug: "a".repeat(65) },
			{ name: " " },
		]) {
			expect((await request("POST", "", { ...input, ...body })).status).toBe(400);
		}
		expect((await request("POST", "", input)).status).toBe(409);
		expect((await request("PATCH", "/missing", { name: "No" })).status).toBe(404);
		expect((await request("DELETE", "/missing")).status).toBe(404);
	});
	it.each([null, 1000])(
		"refuses a space containing a memory with deleted_at=%s",
		async (deletedAt) => {
			const response = await request("POST", "", input);
			expect(response.status).toBe(201);
			const space = (await response.json()) as { id: string };
			store.raw
				.prepare(
					"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at, deleted_at) VALUES ('m', ?, 'T', 'B', 'note', 'key', 'hash', 1, 1, ?)",
				)
				.run(space.id, deletedAt);
			const deleted = await request("DELETE", "/managed");
			expect(deleted.status).toBe(409);
			expect(await deleted.json()).toMatchObject({ error: { code: "space_not_empty" } });
			expect(store.raw.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({ n: 1 });
		},
	);
	it.each(["POST", "PATCH", "DELETE"])(
		"rolls back %s and its change event when idempotency storage fails",
		async (method) => {
			if (method !== "POST") expect((await request("POST", "", input)).status).toBe(201);
			const before = store.raw.prepare("SELECT * FROM spaces").all();
			const changes = store.raw.prepare("SELECT * FROM changes").all();
			store.raw.exec(
				"CREATE TRIGGER fail_chunks BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT, 'storage failed'); END",
			);
			const body = method === "POST" ? input : method === "PATCH" ? { name: "New" } : undefined;
			expect(
				(await request(method, method === "POST" ? "" : "/managed", body, "rollback")).status,
			).toBe(503);
			expect(store.raw.prepare("SELECT * FROM spaces").all()).toEqual(before);
			expect(store.raw.prepare("SELECT * FROM changes").all()).toEqual(changes);
			expect(store.raw.prepare("SELECT * FROM idempotency_records").all()).toEqual([]);
		},
	);
	it.each(["POST", "PATCH", "DELETE"])("commits exactly one concurrent %s", async (method) => {
		if (method !== "POST") expect((await request("POST", "", input)).status).toBe(201);
		const body = method === "POST" ? input : method === "PATCH" ? { name: "New" } : undefined;
		const responses = await Promise.all(
			Array.from({ length: 8 }, () =>
				request(method, method === "POST" ? "" : "/managed", body, "concurrent"),
			),
		);
		expect(responses.map((response) => response.status)).toEqual(
			Array(8).fill(method === "POST" ? 201 : 200),
		);
		expect(
			responses.filter((response) => response.headers.get("Idempotent-Replayed") === "true"),
		).toHaveLength(7);
		expect(new Set(await Promise.all(responses.map((response) => response.text()))).size).toBe(1);
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({
			n: method === "POST" ? 1 : 2,
		});
	});
	it.each(["POST", "PATCH", "DELETE"])(
		"recovers a lost %s commit acknowledgement",
		async (method) => {
			if (method !== "POST") expect((await request("POST", "", input)).status).toBe(201);
			const batch = store.d1.batch.bind(store.d1);
			vi.spyOn(store.d1, "batch").mockImplementationOnce(async (statements) => {
				await batch(statements);
				throw new Error("lost acknowledgement");
			});
			const body = method === "POST" ? input : method === "PATCH" ? { name: "New" } : undefined;
			const response = await request(method, method === "POST" ? "" : "/managed", body, "lost");
			expect(response.status).toBe(method === "POST" ? 201 : 200);
			expect(response.headers.get("Idempotent-Replayed")).toBe("true");
			expect(store.raw.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({
				n: method === "POST" ? 1 : 2,
			});
		},
	);
});
