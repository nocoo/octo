import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { mintApiKey } from "../auth/api-key";
import { hydrateApiKey } from "../auth/bearer";
import { ApiError, jsonOk } from "../lib/errors";
import { adminUsageRoutes } from "../routes/admin/usage";
import { usageRoutes } from "../routes/v1/usage";
import { execution, PEPPER, testApp, testEnv } from "./__tests__/app";
import { auditRow } from "./__tests__/queries";
import { rollupUsage } from "./usage";

const active: ReturnType<typeof sqliteD1>[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const fixture of active.splice(0)) fixture.sqlite.close();
});

async function setup() {
	const fixture = sqliteD1();
	active.push(fixture);
	const key = await mintApiKey(fixture.db, PEPPER, {
		name: "usage-live",
		role: "admin",
		ops: "r,w,u,d",
		scope: "all",
	});
	const app = testApp();
	app.route("/api/v1/usage", usageRoutes());
	app.route("/api/admin/usage", adminUsageRoutes());
	return {
		...fixture,
		key,
		app,
		env: testEnv(fixture.db),
		...execution(),
		headers: { Authorization: `Bearer ${key.plaintext}` },
	};
}

describe("live daily usage accounting", () => {
	it("keeps exact per-key counters fresh beyond 50 sequential requests without another cron", async () => {
		const { app, db, sqlite, key, headers, env, ctx, flush } = await setup();
		let now = Date.UTC(2026, 9, 18, 10);
		vi.spyOn(Date, "now").mockImplementation(() => now);
		app.post("/api/v1/memories", (context) => context.json({ title: "咖啡", ok: true }));
		const input = JSON.stringify({ title: "咖啡", body: "breakfast" });
		const bytesIn = new TextEncoder().encode(input).byteLength;
		let bytesOut = 0;
		for (let index = 0; index < 64; index++) {
			const response = await app.request(
				"/api/v1/memories",
				{
					method: "POST",
					headers: { ...headers, "Content-Length": String(bytesIn) },
					body: input,
				},
				env,
				ctx,
			);
			expect(response.status).toBe(200);
			bytesOut += (await response.arrayBuffer()).byteLength;
			await flush();
			if (index === 49) {
				await rollupUsage(db);
				now += 61_000;
			}
		}
		expect(sqlite.prepare("SELECT count(*) AS n FROM audit_log").get()).toEqual({ n: 64 });
		const expected = {
			day: "2026-10-18",
			key_id: key.row.id,
			calls: 64,
			errors: 0,
			writes: 64,
			bytes_in: bytesIn * 64,
			bytes_out: bytesOut,
		};
		const response = await app.request("/api/v1/usage?key_id=BBBBBBBBBBBB", { headers }, env, ctx);
		const usageBody = await response.text();
		expect(JSON.parse(usageBody)).toEqual({ items: [expected], next_cursor: null });
		await flush();
		const admin = await app.request(`/api/admin/usage?key_id=${key.row.id}`, {}, env, ctx);
		expect(await admin.json()).toEqual({
			items: [
				{
					...expected,
					calls: 65,
					bytes_out: bytesOut + new TextEncoder().encode(usageBody).byteLength,
				},
			],
			next_cursor: null,
		});
		await flush();
		const beforeCron = sqlite.prepare("SELECT * FROM usage_daily").all();
		await rollupUsage(db);
		await rollupUsage(db);
		expect(sqlite.prepare("SELECT * FROM usage_daily").all()).toEqual(beforeCron);
	});

	it("grows a legacy 50-call snapshot with zero output bytes as new requests complete", async () => {
		const { app, db, sqlite, key, headers, env, ctx, flush } = await setup();
		let now = Date.UTC(2026, 9, 18, 10);
		vi.spyOn(Date, "now").mockImplementation(() => now);
		for (let index = 0; index < 50; index++) {
			auditRow(sqlite, {
				id: `legacy-${index}`,
				at: now,
				actor: `key:${key.row.id}`,
				method: "POST",
				bytes_in: 2,
			});
		}
		await rollupUsage(db);
		expect(
			sqlite.prepare("SELECT calls, writes, bytes_in, bytes_out FROM usage_daily").get(),
		).toEqual({
			calls: 50,
			writes: 50,
			bytes_in: 100,
			bytes_out: 0,
		});
		now += 61_000;
		app.post("/api/v1/memories", () => jsonOk({ ok: true }));
		let bytesOut = 0;
		for (let index = 0; index < 64; index++) {
			const response = await app.request(
				"/api/v1/memories",
				{ method: "POST", headers: { ...headers, "Content-Length": "2" }, body: "{}" },
				env,
				ctx,
			);
			bytesOut += (await response.arrayBuffer()).byteLength;
			await flush();
		}
		const expected = { calls: 114, writes: 114, bytes_in: 228, bytes_out: bytesOut };
		expect(bytesOut).toBeGreaterThan(0);
		expect(
			sqlite.prepare("SELECT calls, writes, bytes_in, bytes_out FROM usage_daily").get(),
		).toEqual(expected);
		await rollupUsage(db);
		expect(
			sqlite.prepare("SELECT calls, writes, bytes_in, bytes_out FROM usage_daily").get(),
		).toEqual(expected);
	});

	it("keeps immediate HTTP error and write classifications identical to full rollups", async () => {
		const { app, db, sqlite, key, headers, env, ctx, flush } = await setup();
		vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 18));
		app.get("/api/v1/payload", () => jsonOk({ ok: true }));
		app.post("/api/v1/search", () => jsonOk({ items: [] }));
		app.post("/api/v1/memories:batchGet", () => jsonOk({ items: [] }));
		app.post("/api/v1/memories", () => jsonOk({ ok: true }, 201));
		app.put("/api/v1/memories/:id", () => {
			throw new ApiError("version_conflict", "conflict");
		});
		app.patch("/api/v1/memories/:id", () => jsonOk({ ok: false }, 500));
		app.delete("/api/v1/memories/:id", () => new Response(null, { status: 204 }));
		let bytesOut = 0;
		for (const [method, path] of [
			["GET", "/payload"],
			["POST", "/search"],
			["POST", "/memories:batchGet"],
			["POST", "/memories"],
			["PUT", "/memories/test"],
			["PATCH", "/memories/test"],
			["DELETE", "/memories/test"],
		] as const) {
			const response = await app.request(`/api/v1${path}`, { method, headers }, env, ctx);
			bytesOut += (await response.arrayBuffer()).byteLength;
			await flush();
		}
		const expected = [
			{
				day: "2026-10-18",
				key_id: key.row.id,
				calls: 7,
				errors: 2,
				writes: 2,
				bytes_in: 0,
				bytes_out: bytesOut,
			},
		];
		expect(sqlite.prepare("SELECT * FROM usage_daily").all()).toEqual(expected);
		await rollupUsage(db);
		expect(sqlite.prepare("SELECT * FROM usage_daily").all()).toEqual(expected);
	});

	it("rolls audit and MCP write markers back if the daily update fails", async () => {
		const { app, db, sqlite, key, env, ctx, flush } = await setup();
		const principal = await hydrateApiKey(db, key.row);
		app.post("/mcp", (context) => {
			context.set("apiKey", principal);
			context.set("mcpWrite", true);
			return jsonOk({ ok: true });
		});
		sqlite.exec(`CREATE TRIGGER reject_usage BEFORE INSERT ON usage_daily
			BEGIN SELECT RAISE(ABORT, 'private-storage-failure'); END;`);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const response = await app.request("/mcp", { method: "POST" }, env, ctx);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		await flush();
		expect(log.mock.calls).toEqual([["audit_write_failed"]]);
		for (const table of ["audit_log", "mcp_audit_writes", "usage_daily"]) {
			expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
		}
	});

	it("attributes late stream completion to its original UTC day without cron overwrites", async () => {
		const { app, db, sqlite, key, headers, env, ctx, flush } = await setup();
		let now = Date.UTC(2026, 9, 18) - 1;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		let source!: ReadableStreamDefaultController<Uint8Array>;
		app.post(
			"/api/v1/stream",
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							source = controller;
						},
					}),
				),
		);
		const response = await app.request("/api/v1/stream", { method: "POST", headers }, env, ctx);
		await rollupUsage(db);
		expect(sqlite.prepare("SELECT * FROM usage_daily").all()).toEqual([]);
		now += 61_000;
		source.enqueue(new Uint8Array([1, 2, 3]));
		source.close();
		expect((await response.arrayBuffer()).byteLength).toBe(3);
		await flush();
		const expected = [
			{
				day: "2026-10-17",
				key_id: key.row.id,
				calls: 1,
				errors: 0,
				writes: 1,
				bytes_in: 0,
				bytes_out: 3,
			},
		];
		expect(sqlite.prepare("SELECT * FROM usage_daily").all()).toEqual(expected);
		await rollupUsage(db);
		expect(sqlite.prepare("SELECT * FROM usage_daily").all()).toEqual(expected);
	});
});
