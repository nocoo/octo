import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKey, revokeKey, rotateKey, updateKey } from "../../admin/keys";
import { type ApiKeyRow, lookupApiKey } from "../../auth/api-key";
import type { AppVars, Env } from "../../env";
import { toErrorResponse } from "../../lib/errors";
import { migratedSqlite } from "../../repo/__tests__/sqlite-d1";
import { keysRoutes } from "./keys";

describe("admin keys", () => {
	let store: ReturnType<typeof migratedSqlite>;
	let app: Hono<{ Bindings: Env; Variables: AppVars }>;
	const pepper = "local-admin-test-pepper";
	beforeEach(() => {
		store = migratedSqlite();
		app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.use("*", async (context, next) => {
			context.set("requestId", "admin-request");
			context.set("adminEmail", "owner@local");
			await next();
		});
		app.onError((err, context) => toErrorResponse(err, context.get("requestId")));
		app.route("/api/admin/keys", keysRoutes());
	});
	afterEach(() => {
		store.raw.close();
		vi.restoreAllMocks();
	});

	function request(path = "", method = "GET", body?: unknown, withPepper = true) {
		return app.request(
			`/api/admin/keys${path}`,
			{ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
			{ DB: store.d1, ...(withPepper ? { API_KEY_PEPPER: pepper } : {}) } as Env,
		);
	}
	async function mint(body: Record<string, unknown> = {}) {
		const response = await request("", "POST", { name: "agent", role: "admin", ...body });
		expect(response.status).toBe(201);
		return (await response.json()) as { key: ApiKeyRow; plaintext: string };
	}

	it("mints a usable HMAC-only key and never returns stored hashes", async () => {
		const { key, plaintext } = await mint();
		expect(plaintext).toMatch(new RegExp(`^octo_${key.id}_[A-Z2-7]{52}$`));
		expect(key).toMatchObject({ role: "admin", ops: "r,w,u,d", scope: "all" });
		expect(key).not.toHaveProperty("secret_hash");
		expect(key).not.toHaveProperty("prev_secret_hash");
		expect(await lookupApiKey(store.d1, pepper, plaintext)).toMatchObject({ id: key.id });
		for (const path of ["", `/${key.id}`]) {
			const response = await request(path);
			expect(response.status).toBe(200);
			const raw = await response.text();
			expect(raw).not.toContain("secret_hash");
			expect(raw).not.toContain(plaintext);
		}
		expect(JSON.stringify(store.raw.prepare("SELECT * FROM api_keys").all())).not.toContain(
			plaintext,
		);
		expect(store.raw.prepare("SELECT entity, op, actor FROM changes").get()).toMatchObject({
			entity: "api_key",
			op: "created",
			actor: "admin:owner@local",
		});
	});

	it("marks plaintext responses as non-cacheable and accepts omitted rotation options", async () => {
		const created = await request("", "POST", { name: "uncached", role: "admin" });
		expect(created.status).toBe(201);
		expect(created.headers.get("Cache-Control")).toBe("no-store");
		const { key } = (await created.json()) as { key: { id: string } };
		const rotated = await request(`/${key.id}/rotate`, "POST");
		expect(rotated.status).toBe(200);
		expect(rotated.headers.get("Cache-Control")).toBe("no-store");
	});

	it("validates referenced space ids and supports restricted template scopes", async () => {
		await store.d1
			.prepare(
				"INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('room', 'room', 'Room', 1, 1)",
			)
			.run();
		for (const role of ["drop", "readonly"]) {
			const { key } = await mint({ name: role, role, scope: "spaces", space_ids_json: '["room"]' });
			expect(key.space_ids_json).toBe('["room"]');
		}
		expect((await mint({ name: "own-drop", role: "drop", scope: "own" })).key.scope).toBe("own");
		for (const space_ids_json of ['["room"]', '["room","room"]', "[1]", "{}"]) {
			expect(
				(await request("", "POST", { name: "invalid-ids", role: "admin", space_ids_json })).status,
			).toBe(400);
		}
		const { key, plaintext } = await mint({
			name: "expired",
			expires_at: "2000-01-01T00:00:00.000Z",
		});
		expect(await lookupApiKey(store.d1, pepper, plaintext)).toBeNull();
		await store.d1.prepare("UPDATE api_keys SET last_used_at = 1 WHERE id = ?").bind(key.id).run();
		expect(await (await request(`/${key.id}`)).json()).toMatchObject({
			last_used_at: "1970-01-01T00:00:00.001Z",
		});
	});

	it("keeps metadata and changes atomic and rejects stale mutations", async () => {
		const { key } = await mint();
		const row = await loadKey(store.d1, key.id);
		store.raw.exec(
			"CREATE TRIGGER reject_changes BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'change unavailable'); END",
		);
		expect((await request(`/${key.id}`, "PATCH", { name: "rollback" })).status).toBe(500);
		expect((await loadKey(store.d1, key.id)).name).toBe("agent");
		store.raw.exec("DROP TRIGGER reject_changes");
		await store.d1
			.prepare("UPDATE api_keys SET updated_at = updated_at + 1 WHERE id = ?")
			.bind(key.id)
			.run();
		await expect(
			updateKey(
				store.d1,
				row,
				{
					name: "stale",
					role: "admin",
					ops: "r,w,u,d",
					scope: "all",
					spaceIds: [],
					ownEntriesOnly: false,
					autoOwnSpace: false,
					expiresAt: null,
				},
				"admin:owner@local",
			),
		).rejects.toMatchObject({ code: "version_conflict" });
		await revokeKey(store.d1, await loadKey(store.d1, key.id), "admin:owner@local");
		await expect(rotateKey(store.d1, pepper, row, 0, "admin:owner@local")).rejects.toMatchObject({
			code: "version_conflict",
		});
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({ n: 2 });
	});

	it("does not lose same-millisecond metadata updates", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1000);
		const { key } = await mint();
		const row = await loadKey(store.d1, key.id);
		expect((await request(`/${key.id}`, "PATCH", { name: "first" })).status).toBe(200);
		await expect(
			updateKey(
				store.d1,
				row,
				{
					name: "stale",
					role: "admin",
					ops: "r,w,u,d",
					scope: "all",
					spaceIds: [],
					ownEntriesOnly: false,
					autoOwnSpace: false,
					expiresAt: null,
				},
				"admin:owner@local",
			),
		).rejects.toMatchObject({ code: "version_conflict" });
	});

	it("invalidates the old secret immediately with zero grace under a frozen clock", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1000);
		const { key, plaintext } = await mint();
		expect((await request(`/${key.id}/rotate`, "POST", {})).status).toBe(200);
		expect(await lookupApiKey(store.d1, pepper, plaintext)).toBeNull();
	});

	it("denies an unguarded router instead of using an undefined actor", async () => {
		const unguarded = new Hono<{ Bindings: Env; Variables: AppVars }>();
		unguarded.onError((err) => toErrorResponse(err, "unauthenticated-request"));
		unguarded.route("/", keysRoutes());
		expect((await unguarded.request("/", {}, { DB: store.d1 } as Env)).status).toBe(401);
	});

	it("applies all templates and requires explicit custom permissions", async () => {
		for (const [role, ops, scope, auto] of [
			["project", "r,w,u,d", "own", 1],
			["drop", "w", "spaces", 0],
			["readonly", "r", "all", 0],
			["custom", "w,u", "own", 0],
		] as const) {
			const { key } = await mint({
				name: role,
				role,
				...(role === "custom" ? { ops, scope } : {}),
			});
			expect(key).toMatchObject({ ops, scope, auto_own_space: auto });
		}
		for (const body of [
			{ role: "custom" },
			{ role: "unknown" },
			{ role: "readonly", ops: "r,w" },
			{ role: "project", scope: "all" },
			{ role: "drop", scope: "all" },
			{ role: "custom", scope: "all", ops: "r,x" },
			{ role: "custom", scope: "all", ops: "r,r" },
			{ role: "custom", scope: "spaces", ops: "r", space_ids_json: "bad" },
			{ role: "custom", scope: "spaces", ops: "r", space_ids_json: '["missing"]' },
			{ secret_hash: "injected" },
			{ auto_own_space: 2 },
			{ expires_at: "not-a-date" },
		]) {
			expect((await request("", "POST", { name: "bad", role: "admin", ...body })).status).toBe(400);
		}
	});

	it("patches metadata and resets templates without broadening accidentally", async () => {
		const { key } = await mint();
		const changed = await request(`/${key.id}`, "PATCH", {
			name: "renamed",
			role: "project",
			expires_at: "2099-01-01T00:00:00.000Z",
		});
		expect(changed.status).toBe(200);
		expect(await changed.json()).toMatchObject({
			name: "renamed",
			role: "project",
			scope: "own",
			auto_own_space: 1,
			expires_at: "2099-01-01T00:00:00.000Z",
		});
		expect((await request(`/${key.id}`, "PATCH", { ops: "r" })).status).toBe(400);
		expect((await request(`/${key.id}`, "PATCH", { role: "custom" })).status).toBe(400);
		expect((await request(`/${key.id}`, "PATCH", {})).status).toBe(400);
		const custom = await request(`/${key.id}`, "PATCH", {
			role: "custom",
			ops: "r",
			scope: "all",
			expires_at: null,
		});
		expect(custom.status).toBe(200);
		expect(await custom.json()).toMatchObject({ role: "custom", auto_own_space: 0 });
		expect((await request(`/${key.id}`, "PATCH", { own_entries_only: 1 })).status).toBe(200);
	});

	it("rotates with bounded grace and revokes without losing history", async () => {
		const { key, plaintext } = await mint();
		for (const grace_ms of [-1, 604800001, 1.5, "1"]) {
			expect((await request(`/${key.id}/rotate`, "POST", { grace_ms })).status).toBe(400);
		}
		const rotated = await request(`/${key.id}/rotate`, "POST", { grace_ms: 604800000 });
		expect(rotated.status).toBe(200);
		const fresh = (await rotated.json()) as { key: ApiKeyRow; plaintext: string };
		expect(fresh.plaintext).not.toBe(plaintext);
		expect(fresh.key).not.toHaveProperty("prev_secret_hash");
		expect(await lookupApiKey(store.d1, pepper, plaintext)).not.toBeNull();
		expect(await lookupApiKey(store.d1, pepper, fresh.plaintext)).not.toBeNull();
		const zero = await request(`/${key.id}/rotate`, "POST", {});
		expect(zero.status).toBe(200);
		expect(await lookupApiKey(store.d1, pepper, fresh.plaintext)).toBeNull();
		const latest = (await zero.json()) as { plaintext: string };
		for (const [path, method] of [
			[`/${key.id}/revoke`, "POST"],
			[`/${key.id}`, "DELETE"],
		]) {
			const response = await request(path, method);
			expect(response.status).toBe(200);
			expect(await response.json()).toHaveProperty("revoked_at");
		}
		expect(await lookupApiKey(store.d1, pepper, latest.plaintext)).toBeNull();
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM api_keys").get()).toMatchObject({ n: 1 });
		expect((await request(`/${key.id}/rotate`, "POST", {})).status).toBe(409);
	});

	it("fails closed for missing ids, duplicate names, missing pepper and malformed bodies", async () => {
		for (const [path, method, body] of [
			["/missing", "GET", undefined],
			["/missing", "PATCH", { name: "new" }],
			["/missing", "DELETE", undefined],
			["/missing/rotate", "POST", {}],
			["/missing/revoke", "POST", undefined],
		] as const) {
			expect((await request(path, method, body)).status).toBe(404);
		}
		await mint();
		expect((await request("", "POST", { name: "agent", role: "admin" })).status).toBe(409);
		expect((await request("", "POST", { name: "other", role: "admin" }, false)).status).toBe(503);
		const bad = await app.request("/api/admin/keys", { method: "POST", body: "{" }, {
			DB: store.d1,
			API_KEY_PEPPER: pepper,
		} as Env);
		expect(bad.status).toBe(400);
	});
});
