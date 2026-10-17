import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../../lib/version";
import type { AppVars, Env } from "../env";
import { toErrorResponse } from "../lib/errors";
import { newRequestId, withOctoHeaders } from "../lib/request";
import { testApiPrincipal } from "../test-principal";
import { idempotencyMiddleware } from "./idempotency";
import type { IdempotencyRecord } from "./idempotency-repo";
import { IDEMPOTENCY_PENDING_STATUS } from "./idempotency-storage";
import { requestHash } from "./request-hash";

function mockEnv(records: Map<string, IdempotencyRecord>): Env {
	return {
		DB: {
			prepare: (sql: string) => {
				if (sql.startsWith("SELECT") && sql.includes("idempotency_records")) {
					return {
						bind: (keyId: string, idemKey: string) => ({
							first: async () => records.get(`${keyId}:${idemKey}`) ?? null,
						}),
					};
				}
				if (sql.startsWith("INSERT") && sql.includes("idempotency_records")) {
					return {
						bind: (
							keyId: string,
							idemKey: string,
							hash: string,
							status: number,
							createdAt: number,
						) => ({
							run: async () => {
								const key = `${keyId}:${idemKey}`;
								if (records.has(key)) {
									return { success: false, meta: { changes: 0 } };
								}
								records.set(key, {
									key_id: keyId,
									idem_key: idemKey,
									request_hash: hash,
									status,
									response_json: "",
									created_at: createdAt,
								});
								return { success: true, meta: { changes: 1 } };
							},
						}),
					};
				}
				if (sql.startsWith("UPDATE") && sql.includes("idempotency_records")) {
					return {
						bind: (
							status: number,
							responseJson: string,
							keyId: string,
							idemKey: string,
							hash: string,
							pendingStatus: number,
						) => ({
							run: async () => {
								const key = `${keyId}:${idemKey}`;
								const row = records.get(key);
								if (
									!row ||
									row.request_hash !== hash ||
									row.status !== pendingStatus ||
									pendingStatus !== IDEMPOTENCY_PENDING_STATUS
								) {
									return { success: true, meta: { changes: 0 } };
								}
								records.set(key, {
									...row,
									status,
									response_json: responseJson,
								});
								return { success: true, meta: { changes: 1 } };
							},
						}),
					};
				}
				if (sql.startsWith("DELETE") && sql.includes("idempotency_records")) {
					return {
						bind: (keyId: string, idemKey: string, hash: string, pendingStatus: number) => ({
							run: async () => {
								const key = `${keyId}:${idemKey}`;
								const row = records.get(key);
								if (row?.request_hash === hash && row.status === pendingStatus) {
									records.delete(key);
								}
								return { success: true, meta: { changes: 1 } };
							},
						}),
					};
				}
				throw new Error(`unexpected sql: ${sql}`);
			},
			batch: async (statements: Array<{ run: () => Promise<{ meta: { changes?: number } }> }>) => {
				const results = [];
				for (const statement of statements) {
					results.push(await statement.run());
				}
				return results;
			},
		} as unknown as D1Database,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: () => Promise.resolve(new Response("spa")) } as unknown as Fetcher,
		API_KEY_PEPPER: "pepper",
	};
}

function withPrincipal(app: Hono<{ Bindings: Env; Variables: AppVars }>) {
	app.use("*", async (c, next) => {
		c.set("apiKey", testApiPrincipal());
		c.set("adminEmail", "");
		await next();
	});
}

function testApp(_records: Map<string, IdempotencyRecord>) {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (c, next) => {
		const requestId = newRequestId(c.req.raw);
		c.set("requestId", requestId);
		await next();
		c.res = withOctoHeaders(c.res, requestId, APP_VERSION);
	});
	app.onError((err, c) => toErrorResponse(err, c.get("requestId")));
	withPrincipal(app);
	app.use("*", idempotencyMiddleware());
	let hits = 0;
	app.post("/api/v1/echo", (c) => {
		hits += 1;
		return c.json({ hits }, 201);
	});
	return { app, hits: () => hits };
}

describe("idempotencyMiddleware", () => {
	it("skips non-v1 paths", async () => {
		const records = new Map<string, IdempotencyRecord>();
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.use("*", idempotencyMiddleware());
		app.post("/api/live", (c) => c.json({ ok: true }));
		const res = await app.request(
			"/api/live",
			{ method: "POST", headers: { "Idempotency-Key": "k" }, body: "{}" },
			mockEnv(records),
		);
		expect(res.status).toBe(200);
	});

	it("replays identical write responses", async () => {
		const records = new Map<string, IdempotencyRecord>();
		const { app, hits } = testApp(records);
		const env = mockEnv(records);
		const headers = {
			"Idempotency-Key": "k1",
			"Content-Type": "application/json",
		};
		const body = '{"x":1}';
		const res1 = await app.request("/api/v1/echo", { method: "POST", headers, body }, env);
		expect(res1.status).toBe(201);
		expect(await res1.json()).toEqual({ hits: 1 });
		const res2 = await app.request("/api/v1/echo", { method: "POST", headers, body }, env);
		expect(res2.status).toBe(201);
		expect(res2.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await res2.json()).toEqual({ hits: 1 });
		expect(hits()).toBe(1);
	});

	it("returns conflict when the key is reused with a different body", async () => {
		const records = new Map<string, IdempotencyRecord>();
		const hash = await requestHash("POST", "/api/v1/echo", '{"x":1}');
		records.set("kid:k1", {
			key_id: "kid",
			idem_key: "k1",
			request_hash: hash,
			status: 201,
			response_json: '{"hits":1}',
			created_at: 1,
		});
		const { app } = testApp(records);
		const res = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: {
					"Idempotency-Key": "k1",
					"Content-Type": "application/json",
				},
				body: '{"x":2}',
			},
			mockEnv(records),
		);
		expect(res.status).toBe(409);
	});

	it("allows writes without an idempotency key", async () => {
		const records = new Map<string, IdempotencyRecord>();
		const { app, hits } = testApp(records);
		const env = mockEnv(records);
		const postRes = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
			},
			env,
		);
		expect(postRes.status).toBe(201);
		expect(hits()).toBe(1);
	});

	it("conflicts after a lost insert race with a different hash", async () => {
		const records = new Map<string, IdempotencyRecord>();
		records.set("kid:race", {
			key_id: "kid",
			idem_key: "race",
			request_hash: "other",
			status: 201,
			response_json: "{}",
			created_at: 1,
		});
		let firstFind = true;
		const env: Env = {
			...mockEnv(records),
			DB: {
				prepare: (sql: string) => {
					if (sql.startsWith("SELECT") && sql.includes("idempotency_records")) {
						return {
							bind: () => ({
								first: async () => {
									if (firstFind) {
										firstFind = false;
										return null;
									}
									return records.get("kid:race") ?? null;
								},
							}),
						};
					}
					if (sql.startsWith("INSERT")) {
						return {
							bind: () => ({
								run: async () => ({ success: false, meta: { changes: 0 } }),
							}),
						};
					}
					throw new Error(sql);
				},
			} as unknown as D1Database,
		};
		const { app } = testApp(records);
		const res = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: {
					"Idempotency-Key": "race",
					"Content-Type": "application/json",
				},
				body: '{"x":1}',
			},
			env,
		);
		expect(res.status).toBe(409);
	});

	it("requires an api key when Idempotency-Key is set", async () => {
		const records = new Map<string, IdempotencyRecord>();
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.onError((err, c) => toErrorResponse(err, c.get("requestId") ?? "r"));
		app.use("*", idempotencyMiddleware());
		app.post("/api/v1/echo", (c) => c.json({ ok: true }));
		const res = await app.request(
			"/api/v1/echo",
			{
				method: "POST",
				headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
				body: "{}",
			},
			mockEnv(records),
		);
		expect(res.status).toBe(401);
	});
});
