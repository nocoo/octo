import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { AppVars, Env } from "../env";
import { ApiError, toErrorResponse } from "../lib/errors";
import { testApiPrincipal } from "../test-principal";
import { idempotencyMiddleware } from "./idempotency";

function fixture(principal = true) {
	const { db, sqlite } = sqliteD1();
	sqlite.exec("CREATE TABLE effects (id INTEGER)");
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.onError((err) => toErrorResponse(err, "test"));
	app.use("*", async (c, next) => {
		if (principal)
			c.set("apiKey", { ...testApiPrincipal(), id: c.req.header("Test-Key") ?? "kid" });
		await next();
	});
	app.use("*", idempotencyMiddleware());
	app.post("/api/v1/write", (c) => {
		c.get("writeStatements").push(db.prepare("INSERT INTO effects VALUES (1)"));
		return c.json({ ok: true }, 201);
	});
	app.post("/api/v1/error", (c) => {
		c.get("writeStatements").push(db.prepare("INSERT INTO effects VALUES (1)"));
		throw new ApiError("validation_failed", "invalid");
	});
	app.get("/api/v1/read", (c) => c.json({ ok: true }));
	app.post("/other", (c) => c.json({ ok: true }));
	const req = (
		path = "/api/v1/write",
		headers: Record<string, string> = { "Idempotency-Key": "key" },
		method = "POST",
	) => app.request(path, { method, headers }, { DB: db } as Env);
	return { db, sqlite, req };
}

describe("idempotency middleware", () => {
	it("bypasses reads and non-v1 requests", async () => {
		const f = fixture();
		expect((await f.req("/api/v1/read", {}, "GET")).status).toBe(200);
		expect((await f.req("/other")).status).toBe(200);
		f.sqlite.close();
	});
	it("commits unkeyed writes but never commits an errored request's staged writes", async () => {
		const f = fixture();
		expect((await f.req("/api/v1/write", {})).status).toBe(201);
		expect((await f.req("/api/v1/error", {})).status).toBe(400);
		expect((await f.req("/api/v1/error")).status).toBe(400);
		expect((await f.req("/api/v1/error")).headers.get("Idempotent-Replayed")).toBe("true");
		expect(f.sqlite.prepare("SELECT * FROM effects").all()).toHaveLength(1);
		f.sqlite.close();
	});
	it("isolates the same client key across api keys", async () => {
		const f = fixture();
		for (const key of ["one", "two"])
			expect((await f.req(undefined, { "Idempotency-Key": "same", "Test-Key": key })).status).toBe(
				201,
			);
		expect(f.sqlite.prepare("SELECT * FROM effects").all()).toHaveLength(2);
		f.sqlite.close();
	});
	it("rejects missing auth and explicitly empty keys", async () => {
		const f = fixture(false);
		expect((await f.req()).status).toBe(401);
		expect((await f.req(undefined, { "Idempotency-Key": "" })).status).toBe(400);
		f.sqlite.close();
	});
	it("maps unavailable reads and commits to 503 without leaking details", async () => {
		const f = fixture();
		vi.spyOn(f.db, "prepare").mockImplementationOnce(() => {
			throw new Error("secret");
		});
		expect((await f.req()).status).toBe(503);
		vi.spyOn(f.db, "batch").mockRejectedValue(new Error("secret"));
		expect((await f.req(undefined, {})).status).toBe(503);
		const res = await f.req();
		expect(res.status).toBe(503);
		expect(await res.text()).not.toContain("secret");
		f.sqlite.close();
	});
	it("does not reinterpret storage read failures as conflicts", async () => {
		const f = fixture();
		const prepare = f.db.prepare.bind(f.db);
		let reads = 0;
		vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
			if (sql.startsWith("SELECT request_hash") && ++reads === 2) throw new Error("unavailable");
			return prepare(sql);
		});
		vi.spyOn(f.db, "batch").mockRejectedValue(new Error("unavailable"));
		expect((await f.req()).status).toBe(503);
		f.sqlite.close();
	});
});
