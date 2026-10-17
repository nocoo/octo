import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { AppVars, Env } from "../env";
import { toErrorResponse } from "../lib/errors";
import { testApiPrincipal } from "../test-principal";
import { idempotencyMiddleware } from "./idempotency";

function fixture(body = '{"ok":true}') {
	const { db, sqlite } = sqliteD1();
	sqlite.exec("CREATE TABLE effects (id TEXT PRIMARY KEY)");
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.onError((err, c) => toErrorResponse(err, c.get("requestId") ?? "test"));
	app.use("*", async (c, next) => {
		c.set("apiKey", testApiPrincipal());
		await next();
	});
	app.use("*", idempotencyMiddleware());
	app.post("/api/v1/write", async (c) => {
		const statements = c.get("writeStatements");
		statements.push(db.prepare("INSERT INTO effects VALUES (?)").bind(crypto.randomUUID()));
		await Promise.resolve();
		return c.body(body, 201, { "content-type": "application/json" });
	});
	const post = (raw = "{}", key = "same") =>
		app.request(
			"/api/v1/write",
			{ method: "POST", headers: { "Idempotency-Key": key }, body: raw },
			{ DB: db } as Env,
		);
	const count = () =>
		(sqlite.prepare("SELECT count(*) AS n FROM effects").get() as { n: number }).n;
	return { db, sqlite, app, post, count };
}

describe("atomic idempotency on sqlite", () => {
	it("commits exactly one effect across concurrent requests", async () => {
		const f = fixture();
		const responses = await Promise.all(Array.from({ length: 16 }, () => f.post()));
		expect(responses.map((r) => r.status)).toEqual(Array(16).fill(201));
		expect(f.count()).toBe(1);
		expect(responses.filter((r) => r.headers.get("Idempotent-Replayed") === "true")).toHaveLength(
			15,
		);
		f.sqlite.close();
	});
	it("rolls back all effects if response persistence fails, then recovers", async () => {
		const f = fixture();
		f.sqlite.exec(
			"CREATE TRIGGER fail_chunks BEFORE INSERT ON idempotency_response_chunks BEGIN SELECT RAISE(ABORT, 'storage failure'); END;",
		);
		expect((await f.post()).status).toBe(503);
		expect(f.count()).toBe(0);
		expect(f.sqlite.prepare("SELECT * FROM idempotency_records").all()).toEqual([]);
		f.sqlite.exec("DROP TRIGGER fail_chunks");
		expect((await f.post()).status).toBe(201);
		expect(f.count()).toBe(1);
		expect((await f.post()).headers.get("Idempotent-Replayed")).toBe("true");
		expect(f.count()).toBe(1);
		f.sqlite.close();
	});
	it("replays complete multi-megabyte unicode JSON from separate rows", async () => {
		const body = JSON.stringify({
			results: Array.from({ length: 3 }, () => ({
				ok: true,
				item: { body: "漢😀".repeat(114_000) },
			})),
		});
		const f = fixture(body);
		expect(await (await f.post()).text()).toBe(body);
		const rows = f.sqlite
			.prepare("SELECT body FROM idempotency_response_chunks ORDER BY chunk_index")
			.all() as Array<{ body: string }>;
		expect(rows.length).toBeGreaterThan(3);
		expect(rows.every((r) => new TextEncoder().encode(r.body).length <= 250_000)).toBe(true);
		const replay = await f.post();
		expect(replay.status).toBe(201);
		expect(await replay.text()).toBe(body);
		expect(f.count()).toBe(1);
		f.sqlite.close();
	});
	it("distinguishes hash conflicts and isolates api keys", async () => {
		const f = fixture();
		const responses = await Promise.all([f.post('{"x":1}'), f.post('{"x":2}')]);
		expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
		expect(f.count()).toBe(1);
		for (const key of ["__proto__", "constructor", "prototype"]) {
			expect((await f.post(`{"x":1,"${key}":1}`)).status).toBe(409);
		}
		f.sqlite.close();
	});
	it("can retry after an ambiguous acknowledgement without reexecuting effects", async () => {
		const f = fixture();
		const batch = f.db.batch.bind(f.db);
		vi.spyOn(f.db, "batch").mockImplementationOnce(async (s) => {
			await batch(s);
			throw new Error("lost acknowledgement");
		});
		expect((await f.post()).status).toBe(201);
		expect(f.count()).toBe(1);
		expect((await f.post()).status).toBe(201);
		expect(f.count()).toBe(1);
		f.sqlite.close();
	});
});
