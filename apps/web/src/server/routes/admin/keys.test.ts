import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteKey, loadKey, revokeKey, rotateKey, updateKey } from "../../admin/keys";
import { auditMiddleware } from "../../audit/middleware";
import { lookupApiKey } from "../../auth/api-key";
import type { AppVars, Env } from "../../env";
import { toErrorResponse } from "../../lib/errors";
import { insertSpace, migratedSqlite } from "../../repo/__tests__/sqlite-d1";
import { ChangeRepo } from "../../repo/changes";
import { keysRoutes } from "./keys";

type KeyMetadata = {
	id: string;
	scope: string;
	space_ids: string[];
	own_entries_only: boolean;
	auto_own_space: boolean;
};

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
		return (await response.json()) as { key: KeyMetadata; plaintext: string };
	}

	async function expectFieldErrors(response: Response, paths: string[]) {
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body).toMatchObject({
			error: {
				code: "validation_failed",
				details: {
					issues: expect.arrayContaining(
						paths.map((path) => ({ path, message: expect.any(String) })),
					),
				},
			},
		});
		return body;
	}

	it("mints a usable HMAC-only key and never returns stored hashes", async () => {
		const { key, plaintext } = await mint();
		expect(plaintext).toMatch(new RegExp(`^octo_${key.id}_[A-Z2-7]{52}$`));
		expect(key).toMatchObject({
			role: "admin",
			ops: "r,w,u,d",
			scope: "all",
			space_ids: [],
			own_entries_only: false,
			auto_own_space: false,
		});
		expect(key).not.toHaveProperty("space_ids_json");
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
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({ n: 0 });
	});

	it.each(["project", "custom"] as const)(
		"returns name field errors for invalid auto-owned %s names on create and edit",
		async (role) => {
			const permissions =
				role === "custom" ? { ops: "r,w", scope: "own", auto_own_space: true } : {};
			const { key } = await mint({ name: "a".repeat(64), role, ...permissions });
			for (const name of [
				"a".repeat(65),
				"UpperCase",
				"with space",
				"with/slash",
				"double--hyphen",
			]) {
				for (const response of [
					await request("", "POST", { name, role, ...permissions }),
					await request(`/${key.id}`, "PATCH", { name }),
				]) {
					const error = await expectFieldErrors(response, ["name"]);
					expect(JSON.stringify(error)).not.toContain(name);
				}
			}
		},
	);

	it("creates and edits project keys with fixed permissions and slug-valid names", async () => {
		const { key } = await mint({ name: "project-agent", role: "project", expires_at: null });
		expect(key).toMatchObject({
			ops: "r,w,u,d",
			scope: "own",
			space_ids: [],
			own_entries_only: false,
			auto_own_space: true,
			expires_at: null,
		});
		const edited = await request(`/${key.id}`, "PATCH", {
			name: "renamed-project",
			role: "project",
			expires_at: "2099-01-01T00:00:00.000Z",
		});
		expect(edited.status).toBe(200);
		expect(await edited.json()).toMatchObject({
			name: "renamed-project",
			role: "project",
			ops: "r,w,u,d",
			scope: "own",
			auto_own_space: true,
			expires_at: "2099-01-01T00:00:00.000Z",
		});
		await mint({ name: "long-display-name-".repeat(6), role: "readonly" });
	});

	it("rejects the old custom form's space slug but accepts existing ids on create and edit", async () => {
		const spaceId = "01JSPACE0000000000000000001";
		const nextSpaceId = "01JSPACE0000000000000000002";
		await insertSpace(store.d1, { id: spaceId, slug: "project-room" });
		await insertSpace(store.d1, { id: nextSpaceId, slug: "other-room" });
		const oldPayload = {
			name: "custom-agent",
			role: "custom",
			ops: "r,w,u,d",
			scope: "spaces",
			space_ids: ["project-room"],
			own_entries_only: false,
			auto_own_space: false,
			expires_at: null,
		};
		const invalid = await expectFieldErrors(await request("", "POST", oldPayload), ["space_ids"]);
		expect(invalid).toMatchObject({ error: { message: "unknown space id" } });
		expect(JSON.stringify(invalid)).not.toContain("project-room");
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM api_keys").get()).toMatchObject({ n: 0 });
		const { key } = await mint({ ...oldPayload, space_ids: [spaceId] });
		expect(key).toMatchObject({ ...oldPayload, space_ids: [spaceId] });
		await expectFieldErrors(await request(`/${key.id}`, "PATCH", oldPayload), ["space_ids"]);
		const edited = await request(`/${key.id}`, "PATCH", {
			...oldPayload,
			name: "edited-custom-agent",
			space_ids: [spaceId, nextSpaceId],
			own_entries_only: true,
		});
		expect(edited.status).toBe(200);
		expect(await edited.json()).toMatchObject({
			...oldPayload,
			name: "edited-custom-agent",
			space_ids: [spaceId, nextSpaceId],
			own_entries_only: true,
		});
		expect((await loadKey(store.d1, key.id)).space_ids_json).toBe(
			JSON.stringify([spaceId, nextSpaceId]),
		);
	});

	it("validates an existing display name when custom auto-own is enabled", async () => {
		const { key } = await mint({ name: "Display Name", role: "custom", ops: "w", scope: "own" });
		expect(key.auto_own_space).toBe(false);
		await expectFieldErrors(await request(`/${key.id}`, "PATCH", { auto_own_space: true }), [
			"name",
		]);
		const edited = await request(`/${key.id}`, "PATCH", {
			name: "custom-owner",
			auto_own_space: true,
		});
		expect(edited.status).toBe(200);
		expect(await edited.json()).toMatchObject({ name: "custom-owner", auto_own_space: true });
		expect((await request(`/${key.id}`, "PATCH", { auto_own_space: false })).status).toBe(200);
	});

	it("identifies semantic permission fields without changing role templates", async () => {
		const { key } = await mint();
		for (const [body, paths] of [
			[{ role: "custom" }, ["ops", "scope"]],
			[{ role: "custom", ops: "r" }, ["scope"]],
			[{ role: "custom", scope: "all" }, ["ops"]],
			[{ role: "readonly", ops: "r,w" }, ["ops"]],
			[{ role: "project", scope: "all" }, ["scope"]],
			[{ role: "project", auto_own_space: false }, ["auto_own_space"]],
			[{ space_ids: ["unsubmitted-space-id"] }, ["space_ids"]],
		] as const) {
			await expectFieldErrors(
				await request("", "POST", { name: "invalid-permissions", role: "admin", ...body }),
				[...paths],
			);
			await expectFieldErrors(await request(`/${key.id}`, "PATCH", body), [...paths]);
		}
		expect(await loadKey(store.d1, key.id)).toMatchObject({ role: "admin", ops: "r,w,u,d" });
	});

	it("keeps flat strict schemas, comma-separated ops, booleans and ISO UTC expiry", async () => {
		const { key } = await mint({ role: "custom", ops: "r", scope: "all" });
		for (const [body, paths] of [
			[{ permissions: { ops: "w" } }, [""]],
			[{ ops: ["r", "w"] }, ["ops"]],
			[{ ops: "r,r" }, ["ops"]],
			[{ expires_at: "2026-10-18T12:00" }, ["expires_at"]],
			[{ expires_at: "2026-10-18T12:00:00+08:00" }, ["expires_at"]],
			[{ expires_at: "submitted-invalid-expiry" }, ["expires_at"]],
			[{ auto_own_space: 1 }, ["auto_own_space"]],
			[{ own_entries_only: "false" }, ["own_entries_only"]],
		] as const) {
			for (const response of [
				await request("", "POST", {
					name: "invalid-format",
					role: "custom",
					ops: "r",
					scope: "all",
					...body,
				}),
				await request(`/${key.id}`, "PATCH", body),
			]) {
				const error = await expectFieldErrors(response, [...paths]);
				expect(JSON.stringify(error)).not.toContain("submitted-invalid-expiry");
			}
		}
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
			const { key } = await mint({ name: role, role, scope: "spaces", space_ids: ["room"] });
			expect(key.space_ids).toEqual(["room"]);
			expect(key).not.toHaveProperty("space_ids_json");
			expect((await loadKey(store.d1, key.id)).space_ids_json).toBe('["room"]');
		}
		expect((await mint({ name: "own-drop", role: "drop", scope: "own" })).key.scope).toBe("own");
		for (const space_ids of [["room"], ["room", "room"], [1], {}]) {
			expect(
				(await request("", "POST", { name: "invalid-ids", role: "admin", space_ids })).status,
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

	it("keeps key writes atomic and rejects stale mutations without writing changes", async () => {
		const { key } = await mint();
		const row = await loadKey(store.d1, key.id);
		store.raw.exec(
			"CREATE TRIGGER reject_key_update BEFORE UPDATE ON api_keys BEGIN SELECT RAISE(ABORT, 'key update unavailable'); END",
		);
		expect((await request(`/${key.id}`, "PATCH", { name: "rollback" })).status).toBe(500);
		expect((await loadKey(store.d1, key.id)).name).toBe("agent");
		store.raw.exec("DROP TRIGGER reject_key_update");
		await store.d1
			.prepare("UPDATE api_keys SET updated_at = updated_at + 1 WHERE id = ?")
			.bind(key.id)
			.run();
		await expect(
			updateKey(store.d1, row, {
				name: "stale",
				role: "admin",
				ops: "r,w,u,d",
				scope: "all",
				spaceIds: [],
				ownEntriesOnly: false,
				autoOwnSpace: false,
				expiresAt: null,
			}),
		).rejects.toMatchObject({ code: "version_conflict" });
		await revokeKey(store.d1, await loadKey(store.d1, key.id));
		await expect(rotateKey(store.d1, pepper, row, 0)).rejects.toMatchObject({
			code: "version_conflict",
		});
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({ n: 0 });
	});

	it.each(["rotate", "revoke"] as const)(
		"rejects stale %s without rolling back the permission revision",
		async (operation) => {
			vi.spyOn(Date, "now").mockReturnValue(1000);
			const { key } = await mint({ role: "custom", ops: "r,w,u,d", scope: "all" });
			const original = await loadKey(store.d1, key.id);
			expect((await request(`/${key.id}`, "PATCH", { name: "first" })).status).toBe(200);
			const stalePatch = await loadKey(store.d1, key.id);
			expect((await request(`/${key.id}`, "PATCH", { ops: "r" })).status).toBe(200);
			const current = await loadKey(store.d1, key.id);
			expect(current.updated_at).toBe(1002);
			await expect(
				operation === "rotate"
					? rotateKey(store.d1, pepper, original, 0)
					: revokeKey(store.d1, original),
			).rejects.toMatchObject({ code: "version_conflict" });
			expect(await loadKey(store.d1, key.id)).toEqual(current);
			await expect(
				updateKey(store.d1, stalePatch, {
					name: "stale",
					role: "custom",
					ops: "r,w,u,d",
					scope: "all",
					spaceIds: [],
					ownEntriesOnly: false,
					autoOwnSpace: false,
					expiresAt: null,
				}),
			).rejects.toMatchObject({ code: "version_conflict" });
		},
	);

	it("never publishes key mint, patch, rotation, revoke or delete to all-scope changes", async () => {
		store.raw.exec(
			"INSERT INTO changes (entity, entity_id, space_id, op, actor, at) VALUES ('space', 'room', 'room', 'created', 'admin:owner@local', 1)",
		);
		const changes = new ChangeRepo(store.d1);
		const before = await changes.list({ kind: "all" }, { limit: 200 });
		const head = await changes.head({ kind: "all" });
		const { key } = await mint();
		expect((await request(`/${key.id}`, "PATCH", { name: "renamed" })).status).toBe(200);
		expect((await request(`/${key.id}/rotate`, "POST", {})).status).toBe(200);
		expect((await request(`/${key.id}/revoke`, "POST")).status).toBe(200);
		const deleted = await mint({ name: "deleted" });
		expect((await request(`/${deleted.key.id}/revoke`, "POST")).status).toBe(200);
		expect((await request(`/${deleted.key.id}`, "DELETE")).status).toBe(200);
		expect(await changes.list({ kind: "all" }, { limit: 200 })).toEqual(before);
		expect(await changes.head({ kind: "all" })).toBe(head);
	});

	it("accepts array and boolean API fields and rejects stored-format aliases", async () => {
		const { key } = await mint({
			role: "custom",
			ops: "r",
			scope: "all",
			space_ids: [],
			own_entries_only: true,
			auto_own_space: false,
		});
		expect(key).toMatchObject({ space_ids: [], own_entries_only: true, auto_own_space: false });
		const stored = await loadKey(store.d1, key.id);
		expect(stored).toMatchObject({ space_ids_json: "[]", own_entries_only: 1, auto_own_space: 0 });
		for (const body of [
			{ space_ids_json: "[]" },
			{ space_ids: "[]" },
			{ space_ids: ["room", "room"] },
			{ own_entries_only: 0 },
			{ own_entries_only: 1 },
			{ auto_own_space: 0 },
			{ auto_own_space: 1 },
		]) {
			expect(
				(
					await request("", "POST", {
						name: "legacy",
						role: "custom",
						ops: "r",
						scope: "all",
						...body,
					})
				).status,
			).toBe(400);
			expect((await request(`/${key.id}`, "PATCH", body)).status).toBe(400);
		}
		const updated = await request(`/${key.id}`, "PATCH", {
			own_entries_only: false,
			auto_own_space: true,
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			space_ids: [],
			own_entries_only: false,
			auto_own_space: true,
		});
	});

	it("does not lose same-millisecond metadata updates", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1000);
		const { key } = await mint();
		const row = await loadKey(store.d1, key.id);
		expect((await request(`/${key.id}`, "PATCH", { name: "first" })).status).toBe(200);
		await expect(
			updateKey(store.d1, row, {
				name: "stale",
				role: "admin",
				ops: "r,w,u,d",
				scope: "all",
				spaceIds: [],
				ownEntriesOnly: false,
				autoOwnSpace: false,
				expiresAt: null,
			}),
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
			["project", "r,w,u,d", "own", true],
			["drop", "w", "spaces", false],
			["readonly", "r", "all", false],
			["custom", "w,u", "own", false],
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
			{ role: "custom", scope: "spaces", ops: "r", space_ids: "bad" },
			{ role: "custom", scope: "spaces", ops: "r", space_ids: ["missing"] },
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
			auto_own_space: true,
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
		expect(await custom.json()).toMatchObject({ role: "custom", auto_own_space: false });
		expect((await request(`/${key.id}`, "PATCH", { own_entries_only: true })).status).toBe(200);
	});

	it("rotates with bounded grace and revokes without losing history", async () => {
		const { key, plaintext } = await mint();
		for (const grace_ms of [-1, 604800001, 1.5, "1"]) {
			expect((await request(`/${key.id}/rotate`, "POST", { grace_ms })).status).toBe(400);
		}
		const rotated = await request(`/${key.id}/rotate`, "POST", { grace_ms: 604800000 });
		expect(rotated.status).toBe(200);
		const fresh = (await rotated.json()) as { key: KeyMetadata; plaintext: string };
		expect(fresh.plaintext).not.toBe(plaintext);
		expect(fresh.key).not.toHaveProperty("prev_secret_hash");
		expect(await lookupApiKey(store.d1, pepper, plaintext)).not.toBeNull();
		expect(await lookupApiKey(store.d1, pepper, fresh.plaintext)).not.toBeNull();
		const zero = await request(`/${key.id}/rotate`, "POST", {});
		expect(zero.status).toBe(200);
		expect(await lookupApiKey(store.d1, pepper, fresh.plaintext)).toBeNull();
		const latest = (await zero.json()) as { plaintext: string };
		for (let attempt = 0; attempt < 2; attempt++) {
			const response = await request(`/${key.id}/revoke`, "POST");
			expect(response.status).toBe(200);
			expect(await response.json()).toHaveProperty("revoked_at");
		}
		expect(await lookupApiKey(store.d1, pepper, latest.plaintext)).toBeNull();
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM api_keys").get()).toMatchObject({ n: 1 });
		expect((await request(`/${key.id}/rotate`, "POST", {})).status).toBe(409);
	});

	it("requires revocation before permanently deleting a key", async () => {
		const { key, plaintext } = await mint();
		const active = await loadKey(store.d1, key.id);
		const denied = await request(`/${key.id}`, "DELETE");
		expect(denied.status).toBe(409);
		expect(await denied.json()).toMatchObject({ error: { code: "version_conflict" } });
		expect(await loadKey(store.d1, key.id)).toEqual(active);
		expect(await lookupApiKey(store.d1, pepper, plaintext)).not.toBeNull();
		expect((await request(`/${key.id}/revoke`, "POST")).status).toBe(200);
		const deleted = await request(`/${key.id}`, "DELETE");
		expect(deleted.status).toBe(200);
		expect(deleted.headers.get("Cache-Control")).toBe("no-store");
		expect(await deleted.json()).toEqual({ id: key.id, deleted: true });
		expect((await request(`/${key.id}`)).status).toBe(404);
		expect((await request(`/${key.id}`, "DELETE")).status).toBe(404);
		expect(await lookupApiKey(store.d1, pepper, plaintext)).toBeNull();
		expect(await (await request()).json()).toEqual({ items: [], next_cursor: null });
	});

	it("conditionally deletes only the unchanged revoked key", async () => {
		const { key } = await mint();
		await revokeKey(store.d1, await loadKey(store.d1, key.id));
		const revoked = await loadKey(store.d1, key.id);
		store.raw.prepare("UPDATE api_keys SET updated_at = updated_at + 1 WHERE id = ?").run(key.id);
		await expect(deleteKey(store.d1, revoked)).rejects.toMatchObject({
			code: "version_conflict",
		});
		const current = await loadKey(store.d1, key.id);
		store.raw.prepare("UPDATE api_keys SET revoked_at = NULL WHERE id = ?").run(key.id);
		await expect(deleteKey(store.d1, current)).rejects.toMatchObject({
			code: "version_conflict",
		});
		expect(await loadKey(store.d1, key.id)).toMatchObject({ revoked_at: null });
	});

	it("leaves a revoked key intact if its delete fails", async () => {
		const { key } = await mint();
		await revokeKey(store.d1, await loadKey(store.d1, key.id));
		const revoked = await loadKey(store.d1, key.id);
		store.raw.exec(
			"CREATE TRIGGER reject_key_delete BEFORE DELETE ON api_keys BEGIN SELECT RAISE(ABORT, 'key delete unavailable'); END",
		);
		expect((await request(`/${key.id}`, "DELETE")).status).toBe(500);
		expect(await loadKey(store.d1, key.id)).toEqual(revoked);
	});

	it("retains historical references with foreign keys enabled and audits deletion", async () => {
		store.raw.exec("PRAGMA foreign_keys = ON");
		const { key } = await mint();
		await insertSpace(store.d1, { id: "owned", slug: "owned", ownerKeyId: key.id });
		store.raw
			.prepare(
				"INSERT INTO memories (id, space_id, title, body, type, source_key_id, updated_by_key_id, content_hash, created_at, updated_at) VALUES ('memory', 'owned', 'Keep', 'History', 'note', ?, ?, 'hash', 1, 1)",
			)
			.run(key.id, key.id);
		store.raw
			.prepare(
				"INSERT INTO audit_log (id, at, actor, method, route, status, request_id, duration_ms) VALUES ('history', 1, ?, 'GET', '/api/v1/me', 200, 'historical-request', 1)",
			)
			.run(`key:${key.id}`);
		store.raw
			.prepare("INSERT INTO usage_daily (day, key_id, calls) VALUES ('2026-10-19', ?, 1)")
			.run(key.id);
		await revokeKey(store.d1, await loadKey(store.d1, key.id));
		const audited = new Hono<{ Bindings: Env; Variables: AppVars }>();
		audited.use("*", async (context, next) => {
			context.set("requestId", "00000000-0000-4000-8000-000000000001");
			context.set("adminEmail", "owner@local");
			await next();
		});
		audited.use("*", auditMiddleware);
		audited.route("/api/admin/keys", keysRoutes());
		const pending: Promise<unknown>[] = [];
		const response = await audited.fetch(
			new Request(`http://localhost/api/admin/keys/${key.id}`, { method: "DELETE" }),
			{ DB: store.d1 } as Env,
			{ waitUntil: (task: Promise<unknown>) => pending.push(task) } as unknown as ExecutionContext,
		);
		expect(response.status).toBe(200);
		await response.json();
		await Promise.all(pending);
		expect(store.raw.prepare("SELECT * FROM api_keys").all()).toEqual([]);
		expect(store.raw.prepare("SELECT owner_key_id FROM spaces WHERE id = 'owned'").get()).toEqual({
			owner_key_id: key.id,
		});
		expect(
			store.raw.prepare("SELECT source_key_id, updated_by_key_id FROM memories").get(),
		).toEqual({
			source_key_id: key.id,
			updated_by_key_id: key.id,
		});
		expect(store.raw.prepare("SELECT key_id, calls FROM usage_daily").get()).toEqual({
			key_id: key.id,
			calls: 1,
		});
		expect(store.raw.prepare("SELECT actor FROM audit_log WHERE id = 'history'").get()).toEqual({
			actor: `key:${key.id}`,
		});
		expect(
			store.raw
				.prepare("SELECT actor, method, route, status FROM audit_log WHERE id != 'history'")
				.all(),
		).toEqual([
			{
				actor: "admin:owner@local",
				method: "DELETE",
				route: "/api/admin/keys/:id",
				status: 200,
			},
		]);
		expect(store.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
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
