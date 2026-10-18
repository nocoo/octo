import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { mintApiKey } from "../auth/api-key";
import { ApiError } from "../lib/errors";
import { usageRoutes } from "../routes/v1/usage";
import { execution, PEPPER, testApp, testEnv } from "./__tests__/app";
import { rollupUsage } from "./usage";

const active: ReturnType<typeof sqliteD1>[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const fixture of active.splice(0)) fixture.sqlite.close();
});

function setup() {
	const fixture = sqliteD1();
	active.push(fixture);
	return { ...fixture, env: testEnv(fixture.db), app: testApp(), ...execution() };
}

function logs(sqlite: ReturnType<typeof sqliteD1>["sqlite"]) {
	return sqlite.prepare("SELECT * FROM audit_log ORDER BY id").all();
}

function body(response: Response) {
	if (!response.body) throw new Error("expected a response body");
	return response.body;
}

describe("audit response byte accounting", () => {
	it("counts UTF-8 JSON bytes through audit, rollup and the caller's usage endpoint", async () => {
		const { app, db, sqlite, env, ctx, flush } = setup();
		const key = await mintApiKey(db, PEPPER, {
			name: "reader",
			role: "readonly",
			ops: "r",
			scope: "all",
		});
		app.get("/api/v1/payload", (context) => context.json({ text: "早上喝咖啡☕" }));
		app.route("/api/v1/usage", usageRoutes());
		const headers = { Authorization: `Bearer ${key.plaintext}` };
		const response = await app.request("/api/v1/payload", { headers }, env, ctx);
		expect(response.headers.get("Content-Length")).toBeNull();
		expect(response.headers.get("Content-Type")).toMatch(/application\/json/);
		const text = await response.text();
		expect(JSON.parse(text)).toEqual({ text: "早上喝咖啡☕" });
		await flush();
		const bytes = new TextEncoder().encode(text).byteLength;
		expect(logs(sqlite)[0]).toMatchObject({ status: 200, bytes_out: bytes });
		await rollupUsage(db);
		const usage = await app.request("/api/v1/usage", { headers }, env, ctx);
		expect(await usage.json()).toMatchObject({
			items: [{ key_id: key.row.id, calls: 1, bytes_out: bytes }],
		});
		await flush();
	});

	it("preserves final authentication and error envelopes without storing their contents", async () => {
		const { app, sqlite, env, ctx, flush } = setup();
		app.get("/api/v1/private", () => {
			throw new Error("auth must run first");
		});
		app.get("/error", () => {
			throw new ApiError("version_conflict", "private-response-secret");
		});
		for (const [path, status, code] of [
			["/api/v1/private?key=query-secret", 401, "unauthenticated"],
			["/error", 409, "version_conflict"],
		] as const) {
			const response = await app.request(path, {}, env, ctx);
			expect(response.status).toBe(status);
			const body = await response.text();
			expect(JSON.parse(body)).toMatchObject({ error: { code } });
			await flush();
			expect(logs(sqlite).find((row) => row.status === status)).toMatchObject({
				status,
				error_code: code,
				bytes_out: new TextEncoder().encode(body).byteLength,
			});
		}
		expect(JSON.stringify(logs(sqlite))).not.toMatch(/private-response-secret|query-secret/);
	});

	it("returns a streaming response before EOF and counts binary chunks in waitUntil", async () => {
		const { app, sqlite, env, ctx, tasks, flush } = setup();
		let source!: ReadableStreamDefaultController<Uint8Array>;
		app.get(
			"/stream",
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							source = controller;
						},
					}),
					{ status: 206, statusText: "Partial Content", headers: { "X-Stream": "kept" } },
				),
		);
		const response = await app.request("/stream", {}, env, ctx);
		expect(response.status).toBe(206);
		expect(response.statusText).toBe("Partial Content");
		expect(response.headers.get("X-Stream")).toBe("kept");
		expect(tasks).toHaveLength(1);
		const reader = body(response).getReader();
		source.enqueue(new Uint8Array([0, 128, 255]));
		expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([0, 128, 255]) });
		expect(logs(sqlite)).toHaveLength(0);
		source.enqueue(new Uint8Array([1, 2]));
		source.close();
		expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([1, 2]) });
		expect(await reader.read()).toEqual({ done: true, value: undefined });
		await flush();
		expect(logs(sqlite)[0]).toMatchObject({ status: 206, bytes_out: 5 });
	});

	it("keeps streaming backpressure bounded instead of draining a slow client's entire source", async () => {
		const { app, sqlite, env, ctx, flush } = setup();
		let pulls = 0;
		const cancelled = vi.fn();
		app.get(
			"/large",
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							pulls++;
							controller.enqueue(new Uint8Array(64 * 1024));
						},
						cancel: cancelled,
					}),
				),
		);
		const response = await app.request("/large", {}, env, ctx);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(pulls).toBeLessThanOrEqual(3);
		expect(logs(sqlite)).toHaveLength(0);
		await body(response).cancel("client disconnected");
		await flush();
		expect(cancelled).toHaveBeenCalledWith("client disconnected");
		expect(logs(sqlite)[0]?.bytes_out).toBe(64 * 1024);
	});

	it("preserves source errors and audits only chunks emitted before the failure", async () => {
		const { app, sqlite, env, ctx, flush } = setup();
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = new Error("stream-secret");
		let source!: ReadableStreamDefaultController<Uint8Array>;
		app.get(
			"/broken",
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							source = controller;
						},
					}),
				),
		);
		const response = await app.request("/broken", {}, env, ctx);
		const reader = body(response).getReader();
		source.enqueue(new Uint8Array([1, 2, 3]));
		expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
		const next = reader.read();
		source.error(failure);
		await expect(next).rejects.toBe(failure);
		await flush();
		expect(logs(sqlite)[0]).toMatchObject({ status: 200, error_code: null, bytes_out: 3 });
		expect(log).not.toHaveBeenCalled();
		expect(JSON.stringify(logs(sqlite))).not.toContain("stream-secret");
	});

	it("keeps the pipe attached to waitUntil even when audit storage will fail", async () => {
		const { app, db, sqlite, env, ctx, flush } = setup();
		let source!: ReadableStreamDefaultController<Uint8Array>;
		app.get(
			"/storage-failure",
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							source = controller;
						},
					}),
				),
		);
		vi.spyOn(db, "prepare").mockImplementation(() => {
			throw new Error("storage-secret");
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const response = await app.request("/storage-failure", {}, env, ctx);
		let settled = false;
		const finished = flush().then(() => {
			settled = true;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(settled).toBe(false);
		source.enqueue(new Uint8Array([1, 2, 3]));
		source.close();
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
		await finished;
		expect(log.mock.calls).toEqual([["audit_write_failed"]]);
		expect(logs(sqlite)).toHaveLength(0);
	});

	it("keeps response-ready timing rather than including a slow stream's lifetime", async () => {
		const { app, sqlite, env, ctx, flush } = setup();
		let now = 1_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		let source!: ReadableStreamDefaultController<Uint8Array>;
		app.get(
			"/slow",
			() =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							source = controller;
						},
					}),
				),
		);
		const response = await app.request("/slow", {}, env, ctx);
		now += 60_000;
		source.close();
		expect(await response.text()).toBe("");
		await flush();
		expect(logs(sqlite)[0]).toMatchObject({ at: 1_000, duration_ms: 0, bytes_out: 0 });
	});

	it.each(["head", "empty", "no-content", "not-modified"])(
		"counts %s responses as zero without consuming a representation body",
		async (kind) => {
			const { app, sqlite, env, ctx, flush } = setup();
			const pull = vi.fn();
			app.get("/empty", () => {
				if (kind === "head")
					return new Response(new ReadableStream({ pull }), {
						headers: { "Content-Length": "17" },
					});
				return new Response(null, {
					status: kind === "no-content" ? 204 : kind === "not-modified" ? 304 : 200,
					headers: { "Content-Length": "17" },
				});
			});
			const response = await app.request(
				"/empty",
				{ method: kind === "head" ? "HEAD" : "GET" },
				env,
				ctx,
			);
			expect(response.body).toBeNull();
			await flush();
			expect(logs(sqlite)[0]?.bytes_out).toBe(0);
			expect(pull.mock.calls.length).toBeLessThanOrEqual(1);
		},
	);
});
