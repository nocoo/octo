import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../../tests/fixtures/sqlite-d1";
import { adminWriteOriginMiddleware } from "../../auth/origin";
import type { AppVars, Env } from "../../env";
import { toErrorResponse } from "../../lib/errors";
import { accessMiddleware } from "../../middleware/access";
import { createAdminParityRoutes } from "./parity";

export function parityFixture() {
	const { db, sqlite } = sqliteD1();
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.onError((error) => toErrorResponse(error, "parity-test"));
	app.use("/api/admin/*", accessMiddleware, adminWriteOriginMiddleware);
	app.route("/api/admin", createAdminParityRoutes());
	app.post("/api/admin/keys", (context) => context.json({ plaintext: "must-not-persist" }));
	const files = { put: vi.fn(), delete: vi.fn() };
	const env = {
		DB: db,
		FILES: files,
		RESOURCE_ENV: "development",
		ACCESS_DEV_BYPASS_EMAIL: "owner@local",
		ATTACHMENT_URL_SECRET: "attachment-secret",
	} as unknown as Env;
	const request = (
		path: string,
		method = "GET",
		body?: unknown,
		options: { email?: string; idem?: string; origin?: string; raw?: string } = {},
	) =>
		app.request(
			`http://localhost/api/admin${path}`,
			{
				method,
				headers: {
					Authorization: "Bearer caller-key-must-not-be-used",
					Origin: options.origin ?? "https://octo.dev.hexly.ai",
					"Content-Type": options.raw === undefined ? "application/json" : "image/png",
					"X-Filename": "note.png",
					...(options.idem ? { "Idempotency-Key": options.idem } : {}),
				},
				...(options.raw === undefined
					? body === undefined
						? {}
						: { body: JSON.stringify(body) }
					: { body: options.raw }),
			},
			{ ...env, ACCESS_DEV_BYPASS_EMAIL: options.email ?? env.ACCESS_DEV_BYPASS_EMAIL },
		);
	const create = async (tags = ["first"]) => {
		const response = await request("/memories", "POST", {
			space: "kb",
			title: "title",
			body: "body",
			type: "note",
			tags,
		});
		expect(response.status).toBe(201);
		return (await response.json()) as { id: string; version: number; source_key_id: string };
	};
	return { db, sqlite, app, env, files, request, create };
}

describe("admin parity integration", () => {
	it("uses only Access identity, denies missing identity and enforces origin", async () => {
		const { request, sqlite } = parityFixture();
		expect((await request("/memories", "GET", undefined, { email: "" })).status).toBe(401);
		expect(
			(await request("/memories", "POST", {}, { origin: "https://evil.example" })).status,
		).toBe(403);
		expect(sqlite.prepare("SELECT * FROM api_keys").all()).toEqual([]);
		const unprotected = new Hono<{ Bindings: Env; Variables: AppVars }>();
		unprotected.onError((error) => toErrorResponse(error, "test"));
		unprotected.route("/api/admin", createAdminParityRoutes());
		expect((await unprotected.request("/api/admin/memories")).status).toBe(401);
	});

	it("mirrors memory, version, trash and changes through the staged M2 boundary", async () => {
		const { create, request, sqlite, db } = parityFixture();
		const batch = vi.spyOn(db, "batch");
		const item = await create();
		expect(batch).toHaveBeenCalledTimes(1);
		expect(item.source_key_id).toBe("admin:owner@local");
		expect((await request("/memories")).status).toBe(200);
		expect((await request(`/memories/${item.id}`)).status).toBe(200);
		expect(
			(await request(`/memories/${item.id}`, "PATCH", { title: "changed", expected_version: 1 }))
				.status,
		).toBe(200);
		for (const suffix of ["versions", "versions/1", "diff?from=1&to=2"])
			expect((await request(`/memories/${item.id}/${suffix}`)).status).toBe(200);
		expect(
			(
				await request(`/memories/${item.id}/rollback`, "POST", {
					to_version: 1,
					expected_version: 2,
				})
			).status,
		).toBe(200);
		expect((await request(`/memories/${item.id}`, "DELETE")).status).toBe(200);
		expect(await (await request("/trash")).json()).toMatchObject({ items: [{ id: item.id }] });
		expect((await request(`/trash/${item.id}/restore`, "POST")).status).toBe(200);
		for (const path of ["/changes", "/changes/head"])
			expect((await request(path)).status).toBe(200);
		for (const table of ["memory_versions", "changes"])
			expect(sqlite.prepare(`SELECT DISTINCT actor FROM ${table}`).all()).toEqual([
				{ actor: "admin:owner@local" },
			]);
		expect(sqlite.prepare("SELECT updated_by_key_id FROM memories").get()).toEqual({
			updated_by_key_id: "admin:owner@local",
		});
	});

	it("reuses batch, tags, search and attachments without key-prefixed admin actors", async () => {
		const { create, request, sqlite, files } = parityFixture();
		const item = await create();
		expect((await request("/memories:batchGet", "POST", { ids: [item.id] })).status).toBe(200);
		expect((await request("/search", "POST", { query: "title" })).status).toBe(200);
		expect((await request("/tags")).status).toBe(200);
		expect((await request("/tags/first/rename", "POST", { new_name: "second" })).status).toBe(200);
		await create(["third"]);
		expect((await request("/tags/second/merge", "POST", { into: "third" })).status).toBe(200);
		const uploaded = await request(`/memories/${item.id}/attachments`, "POST", undefined, {
			raw: "file bytes",
			idem: "upload",
		});
		expect(uploaded.status).toBe(201);
		const attachment = (await uploaded.json()) as { id: string };
		expect(files.put).toHaveBeenCalledTimes(1);
		expect((await request(`/memories/${item.id}/attachments`)).status).toBe(200);
		expect((await request(`/attachments/${attachment.id}/url`)).status).toBe(200);
		expect((await request(`/attachments/${attachment.id}`, "DELETE")).status).toBe(200);
		const batch = await request("/memories:batchCreate", "POST", {
			items: [{ space: "other", title: "batch", body: "body", type: "note", tags: [] }],
		});
		expect(batch.status).toBe(200);
		const { results } = (await batch.json()) as { results: Array<{ item: { id: string } }> };
		const id = results[0]?.item.id;
		expect(id).toBeTruthy();
		expect(
			(
				await request("/memories:batchUpdate", "POST", {
					items: [{ id, title: "new", expected_version: 1 }],
				})
			).status,
		).toBe(200);
		expect((await request("/memories:batchDelete", "POST", { ids: [id] })).status).toBe(200);
		expect(sqlite.prepare("SELECT DISTINCT actor FROM changes").all()).toEqual([
			{ actor: "admin:owner@local" },
		]);
		expect(sqlite.prepare("SELECT created_by FROM attachments").get()).toEqual({
			created_by: "admin:owner@local",
		});
	});

	it("isolates idempotency by Access actor and never wraps sibling key mint routes", async () => {
		const { request, app, env, sqlite } = parityFixture();
		const body = { space: "kb", title: "title", body: "body", type: "note", tags: [] };
		const first = await request("/memories", "POST", body, { idem: "same" });
		const replay = await request("/memories", "POST", body, { idem: "same" });
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(await first.text());
		expect(
			(await request("/memories", "POST", { ...body, title: "different" }, { idem: "same" }))
				.status,
		).toBe(409);
		expect(
			(await request("/memories", "POST", body, { idem: "same", email: "other@local" })).status,
		).toBe(201);
		expect(sqlite.prepare("SELECT key_id FROM idempotency_records ORDER BY key_id").all()).toEqual([
			{ key_id: "admin:other@local" },
			{ key_id: "admin:owner@local" },
		]);
		expect(
			(
				await app.request(
					"http://localhost/api/admin/keys",
					{
						method: "POST",
						headers: { Origin: "https://octo.dev.hexly.ai", "Idempotency-Key": "mint" },
					},
					env,
				)
			).status,
		).toBe(200);
		expect(
			sqlite.prepare("SELECT * FROM idempotency_records WHERE idem_key = 'mint'").all(),
		).toEqual([]);
	});

	it("rolls back staged writes when D1 is unavailable", async () => {
		const { db, request, sqlite } = parityFixture();
		vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("private database error"));
		const response = await request("/memories", "POST", {
			space: "kb",
			title: "title",
			body: "body",
			type: "note",
			tags: ["new"],
		});
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("private database error");
		for (const table of ["memories", "tags", "memory_versions", "changes"])
			expect(sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
	});
});
