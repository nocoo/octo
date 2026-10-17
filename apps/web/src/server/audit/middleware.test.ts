import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { hashSecret, mintApiKey } from "../auth/api-key";
import type { AppVars, Env } from "../env";
import { idempotencyMiddleware } from "../http/idempotency";
import { ApiError } from "../lib/errors";
import { execution, PEPPER, testApp, testEnv } from "./__tests__/app";
import { auditMiddleware } from "./middleware";

afterEach(() => vi.restoreAllMocks());

function setup() {
	const { db, sqlite } = sqliteD1();
	return { db, sqlite, env: testEnv(db), app: testApp(), ...execution() };
}

function rows(sqlite: ReturnType<typeof sqliteD1>["sqlite"]) {
	return sqlite.prepare("SELECT * FROM audit_log ORDER BY at, id").all();
}

describe("audit middleware", () => {
	it.each(["version_conflict", "tag_conflict", "idempotency_conflict"] as const)(
		"preserves the exact %s audit code on idempotent error replay",
		async (code) => {
			const { db, sqlite, env, app, ctx, flush } = setup();
			const key = await mintApiKey(db, PEPPER, {
				name: "writer",
				role: "admin",
				ops: "r,w,u,d",
				scope: "all",
			});
			app.use("/api/v1/*", idempotencyMiddleware());
			app.post("/api/v1/error", () => {
				throw new ApiError(code, "private message");
			});
			for (let attempt = 0; attempt < 2; attempt++) {
				const response = await app.request(
					"http://local/api/v1/error",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${key.plaintext}`,
							"Idempotency-Key": "error-replay",
						},
						body: "{}",
					},
					env,
					ctx,
				);
				expect(response.status).toBe(409);
				expect(response.headers.get("Idempotent-Replayed")).toBe(attempt === 1 ? "true" : null);
			}
			await flush();
			expect(rows(sqlite).map((row) => row.error_code)).toEqual([code, code]);
			sqlite.close();
		},
	);

	it("audits denied, missing, admin and authenticated calls with final status", async () => {
		const { db, sqlite, env, app, ctx, flush } = setup();
		const key = await mintApiKey(db, PEPPER, {
			name: "reader",
			role: "readonly",
			ops: "r",
			scope: "all",
		});
		app.get("/api/v1/memories/:id", () => {
			throw new ApiError("forbidden", "secret message");
		});
		app.get("/api/admin/final", (context) => context.json({ ok: true }));
		app.use("/final", async (context, next) => {
			await next();
			context.res = new Response(null, { status: 202 });
		});
		app.get("/final", (context) => context.text("ok"));
		const probes = [
			["/api/v1/memories/raw-secret?key=query-secret", {}, 401],
			["/api/v1/memories/raw-secret", { Authorization: `Bearer ${key.plaintext}` }, 403],
			["/unregistered/raw-secret?key=query-secret", {}, 404],
			["/api/admin/final", {}, 200],
			["/final", {}, 202],
		] as const;
		for (const [url, headers, status] of probes) {
			const res = await app.request(`http://localhost${url}`, { headers }, env, ctx);
			expect(res.status).toBe(status);
		}
		await flush();
		const logs = rows(sqlite);
		expect(logs).toHaveLength(5);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					actor: "anonymous",
					route: "/api/v1/memories/:id",
					status: 401,
					error_code: "unauthenticated",
				}),
				expect.objectContaining({
					actor: `key:${key.row.id}`,
					status: 403,
					error_code: "forbidden",
				}),
				expect.objectContaining({
					actor: "anonymous",
					route: "unmatched",
					status: 404,
					error_code: "not_found",
				}),
				expect.objectContaining({
					actor: "admin:admin@example.com",
					route: "/api/admin/final",
					error_code: null,
				}),
				expect.objectContaining({ route: "/final", status: 202 }),
			]),
		);
		expect(JSON.stringify(logs)).not.toMatch(/raw-secret|query-secret|secret message|octo_/);
		sqlite.close();
	});

	it("never reads streams or stores request secrets and HMACs IPs", async () => {
		const { sqlite, env, app, ctx, flush } = setup();
		const requestId = crypto.randomUUID();
		const responseBody = new ReadableStream({ start() {} });
		app.post(
			"/upload/:id{[a-z-]+}",
			() => new Response(responseBody, { headers: { "Content-Length": "17" } }),
		);
		const request = new Request("http://localhost/upload/path-secret?key=query-secret", {
			method: "POST",
			body: "body-secret",
			headers: {
				"Content-Length": "11",
				"User-Agent": "agent-key-secret",
				"Idempotency-Key": "idem-secret",
				"X-Request-Id": requestId,
				"CF-Connecting-IP": "192.0.2.1",
				Authorization: "Bearer key-secret",
			},
		});
		const reader = vi.spyOn(request, "text");
		const response = await app.fetch(request, env, ctx);
		expect(response.status).toBe(200);
		await flush();
		expect(request.bodyUsed).toBe(false);
		expect(response.bodyUsed).toBe(false);
		expect(reader).not.toHaveBeenCalled();
		expect(rows(sqlite)[0]).toMatchObject({
			route: "/upload/:id",
			request_id: requestId,
			bytes_in: 11,
			bytes_out: 17,
			ip_hash: await hashSecret(PEPPER, "192.0.2.1"),
			user_agent: null,
			idem_key: null,
			entity_id: null,
			space_id: null,
		});
		expect(JSON.stringify(rows(sqlite))).not.toMatch(/secret|192\.0\.2\.1/);
		sqlite.close();
	});

	it.each(["-1", "1e3", "1.2", "999999999999999999999", "4294967296", "+12", "abc", ""])(
		"ignores unbounded or invalid byte header %s",
		async (length) => {
			const { sqlite, env, app, ctx, flush } = setup();
			app.get("/size", () => new Response("body", { headers: { "Content-Length": length } }));
			await app.request(
				"/size",
				{ headers: { "Content-Length": length, "X-Request-Id": "octo_key-secret" } },
				env,
				ctx,
			);
			await flush();
			expect(rows(sqlite)[0]).toMatchObject({ bytes_in: null, bytes_out: null });
			expect(rows(sqlite)[0]?.request_id).toMatch(/^[a-f0-9-]{36}$/);
			sqlite.close();
		},
	);

	it("accepts zero bytes, normalizes unknown methods and omits IP without pepper", async () => {
		const { sqlite, env, app, ctx, flush } = setup();
		delete env.API_KEY_PEPPER;
		app.on("SECRET", "/custom", () => new Response(null, { headers: { "Content-Length": "0" } }));
		await app.request(
			"/custom",
			{ method: "SECRET", headers: { "CF-Connecting-IP": "192.0.2.1" } },
			env,
			ctx,
		);
		await flush();
		expect(rows(sqlite)[0]).toMatchObject({
			method: "OTHER",
			ip_hash: null,
			bytes_in: null,
			bytes_out: 0,
		});
		sqlite.close();
	});

	it("keeps database failures out of the response and emits only a static code", async () => {
		const { sqlite, db, env, app, ctx, flush } = setup();
		app.get("/boom", () => {
			throw new Error("private-secret");
		});
		vi.spyOn(db, "prepare").mockImplementation(() => {
			throw new Error("db-secret");
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect((await app.request("/boom", {}, env, ctx)).status).toBe(500);
		await expect(flush()).resolves.toBeDefined();
		expect(log).toHaveBeenCalledWith("audit_write_failed");
		expect(log.mock.calls.flat()).toEqual(["audit_write_failed"]);
		sqlite.close();
	});

	it("returns before D1 completes and tolerates absent or failing waitUntil", async () => {
		const { db, sqlite, env, app } = setup();
		app.get("/ok", (context) => context.text("ok"));
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const original = db.prepare.bind(db);
		vi.spyOn(db, "prepare").mockImplementation((sql) => {
			const statement = original(sql);
			const bind = statement.bind.bind(statement);
			statement.bind = (...values: unknown[]) => {
				const bound = bind(...values);
				const run = bound.run.bind(bound);
				bound.run = async () => {
					await blocked;
					return run();
				};
				return bound;
			};
			return statement;
		});
		const exec = execution();
		expect((await app.request("/ok", {}, env, exec.ctx)).status).toBe(200);
		expect(rows(sqlite)).toHaveLength(0);
		release();
		await exec.flush();
		expect(rows(sqlite)).toHaveLength(1);
		await app.request("/ok", {}, env);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		await app.request("/ok", {}, env, {
			waitUntil() {
				throw new Error("context-secret");
			},
		} as unknown as ExecutionContext);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(log.mock.calls.flat()).not.toContain("context-secret");
		expect(rows(sqlite)).toHaveLength(3);
		sqlite.close();
	});

	it("can run before request-id middleware and handles generic failures", async () => {
		const { db, sqlite } = sqliteD1();
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.use("*", auditMiddleware);
		app.onError(() => new Response(null, { status: 503 }));
		app.get("/error", () => {
			throw new Error("secret");
		});
		const { ctx, flush } = execution();
		await app.request("/error", {}, testEnv(db), ctx);
		await flush();
		expect(rows(sqlite)[0]).toMatchObject({
			error_code: "unavailable",
			status: 503,
			request_id: expect.any(String),
			duration_ms: expect.any(Number),
		});
		sqlite.close();
	});
});
