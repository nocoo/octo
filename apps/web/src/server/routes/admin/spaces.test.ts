import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSpace } from "../../admin/spaces";
import { mintApiKey } from "../../auth/api-key";
import type { AppVars, Env } from "../../env";
import { toErrorResponse } from "../../lib/errors";
import { migratedSqlite } from "../../repo/__tests__/sqlite-d1";
import { SpaceRepo } from "../../repo/spaces";
import { keysRoutes } from "./keys";
import { adminSpacesRoutes } from "./spaces";

describe("admin spaces", () => {
	let store: ReturnType<typeof migratedSqlite>;
	let app: Hono<{ Bindings: Env; Variables: AppVars }>;
	beforeEach(() => {
		store = migratedSqlite();
		store.raw.exec("PRAGMA foreign_keys = ON");
		app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.use("*", async (context, next) => {
			context.set("requestId", "admin-request");
			context.set("adminEmail", "owner@local");
			await next();
		});
		app.onError((err, context) => toErrorResponse(err, context.get("requestId")));
		app.route("/api/admin/spaces", adminSpacesRoutes());
		app.route("/api/admin/keys", keysRoutes());
	});
	afterEach(() => {
		store.raw.close();
		vi.restoreAllMocks();
	});
	function request(path = "", method = "GET", body?: unknown) {
		return app.request(
			`/api/admin/spaces${path}`,
			{
				method,
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ DB: store.d1 } as Env,
		);
	}
	async function create(body: Record<string, unknown> = {}) {
		const response = await request("", "POST", { slug: "workspace", name: "Workspace", ...body });
		expect(response.status).toBe(201);
		return (await response.json()) as { id: string; slug: string };
	}

	it("creates, lists, renames and deletes empty spaces with stable ids and admin changes", async () => {
		const owner = await mintApiKey(store.d1, "local-pepper", {
			name: "owner",
			role: "project",
			ops: "r,w,u,d",
			scope: "own",
		});
		const space = await create({ owner_key_id: owner.row.id });
		expect(space.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		const listed = await request();
		expect(await listed.json()).toMatchObject({
			items: [{ id: space.id, owner_key_id: owner.row.id, memory_count: 0 }],
			next_cursor: null,
		});
		const fetched = await request("/workspace");
		expect(fetched.status).toBe(200);
		expect(await fetched.json()).toMatchObject({
			description: "",
			created_at: expect.stringMatching(/Z$/),
		});
		const update = await request("/workspace", "PATCH", {
			slug: "renamed",
			description: "Changed",
			owner_key_id: null,
		});
		expect(update.status).toBe(200);
		expect(await update.json()).toMatchObject({
			id: space.id,
			slug: "renamed",
			description: "Changed",
			owner_key_id: null,
		});
		expect((await request("/workspace")).status).toBe(404);
		expect((await request("/renamed", "PATCH", { name: "New name" })).status).toBe(200);
		const deleted = await request("/renamed", "DELETE");
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ id: space.id, slug: "renamed", deleted: true });
		expect(await (await request()).json()).toEqual({ items: [], next_cursor: null });
		expect(store.raw.prepare("SELECT op, actor, space_id FROM changes ORDER BY seq").all()).toEqual(
			[
				{ op: "created", actor: "admin:owner@local", space_id: space.id },
				{ op: "updated", actor: "admin:owner@local", space_id: space.id },
				{ op: "updated", actor: "admin:owner@local", space_id: space.id },
				{ op: "deleted", actor: "admin:owner@local", space_id: space.id },
			],
		);
	});

	it("keeps spaces editable after deleting their revoked owner key", async () => {
		const owner = await mintApiKey(store.d1, "local-pepper", {
			name: "historical-owner",
			role: "project",
			ops: "r,w,u,d",
			scope: "own",
		});
		const space = await create({ owner_key_id: owner.row.id });
		for (const [path, method] of [
			[`/api/admin/keys/${owner.row.id}/revoke`, "POST"],
			[`/api/admin/keys/${owner.row.id}`, "DELETE"],
		] as const) {
			const response = await app.request(path, { method }, { DB: store.d1 } as Env);
			expect(response.status).toBe(200);
		}
		expect(store.raw.prepare("SELECT id FROM api_keys WHERE id = ?").all(owner.row.id)).toEqual([]);
		for (const patch of [
			{ name: "Renamed" },
			{ description: "Retained history", owner_key_id: owner.row.id },
			{ slug: "renamed" },
		]) {
			const response = await request("/workspace", "PATCH", patch);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ id: space.id, owner_key_id: owner.row.id });
		}
		expect((await request("/renamed", "PATCH", { owner_key_id: "missing" })).status).toBe(400);
		expect(await (await request("/renamed")).json()).toMatchObject({
			name: "Renamed",
			description: "Retained history",
			owner_key_id: owner.row.id,
		});
		const replacement = await mintApiKey(store.d1, "local-pepper", {
			name: "replacement-owner",
			role: "project",
			ops: "r,w,u,d",
			scope: "own",
		});
		const reassigned = await request("/renamed", "PATCH", { owner_key_id: replacement.row.id });
		expect(reassigned.status).toBe(200);
		expect(await reassigned.json()).toMatchObject({ owner_key_id: replacement.row.id });
		const cleared = await request("/renamed", "PATCH", { owner_key_id: null });
		expect(cleared.status).toBe(200);
		expect(await cleared.json()).toMatchObject({ owner_key_id: null });
	});

	it("keeps created and renamed slugs within the memory write contract", async () => {
		const accepted = "a".repeat(64);
		await create({ slug: accepted });
		expect((await request("", "POST", { slug: "a".repeat(65), name: "too long" })).status).toBe(
			400,
		);
		expect((await request(`/${accepted}`, "PATCH", { slug: "b".repeat(65) })).status).toBe(400);
	});

	it("rejects deletion of live and trashed memories without writing a change", async () => {
		for (const deleted_at of [null, 1000]) {
			const slug = deleted_at === null ? "live" : "trashed";
			const space = await create({ slug });
			await store.d1
				.prepare(
					"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at, deleted_at) VALUES (?, ?, 'T', 'B', 'note', 'key', 'hash', 1, 1, ?)",
				)
				.bind(slug, space.id, deleted_at)
				.run();
			const response = await request(`/${slug}`, "DELETE");
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({
				error: { code: "version_conflict", request_id: "admin-request" },
			});
			expect((await request(`/${slug}`)).status).toBe(200);
		}
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM changes").get()).toMatchObject({ n: 2 });
	});

	it("validates strict fields, ownership, duplicates and missing resources", async () => {
		await create();
		for (const body of [
			{ slug: "Bad Slug" },
			{ slug: "" },
			{ name: "" },
			{ owner_key_id: "unknown" },
			{ owner_key_id: 1 },
			{ unexpected: true },
		]) {
			expect((await request("", "POST", { slug: "valid", name: "Valid", ...body })).status).toBe(
				400,
			);
			expect((await request("/workspace", "PATCH", body)).status).toBe(400);
		}
		expect((await request("/workspace", "PATCH", {})).status).toBe(400);
		expect((await request("", "POST", { slug: "workspace", name: "Other" })).status).toBe(409);
		await create({ slug: "other" });
		expect((await request("/other", "PATCH", { slug: "workspace" })).status).toBe(409);
		for (const method of ["GET", "PATCH", "DELETE"]) {
			expect(
				(await request("/missing", method, method === "PATCH" ? { name: "New" } : undefined))
					.status,
			).toBe(404);
		}
	});

	it("rolls back the mutation when its change record fails", async () => {
		store.raw.exec(
			"CREATE TRIGGER reject_changes BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'change unavailable'); END",
		);
		const response = await request("", "POST", { slug: "rollback", name: "Rollback" });
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({ error: { code: "internal" } });
		expect(store.raw.prepare("SELECT COUNT(*) AS n FROM spaces").get()).toMatchObject({ n: 0 });
	});

	it("rejects stale updates even when the clock has not advanced", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1000);
		await create();
		const row = await new SpaceRepo(store.d1).getVisibleBySlug("workspace", { kind: "all" });
		if (!row) throw new Error("missing test space");
		expect((await request("/workspace", "PATCH", { name: "first" })).status).toBe(200);
		await expect(
			updateSpace(store.d1, row, { name: "stale" }, "admin:owner@local"),
		).rejects.toMatchObject({ code: "version_conflict" });
	});
});
