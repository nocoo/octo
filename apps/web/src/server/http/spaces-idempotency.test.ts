import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { AppVars, Env } from "../env";
import { jsonOk, toErrorResponse } from "../lib/errors";
import { spacesRoutes } from "../routes/v1/spaces";
import { testApiPrincipal } from "../test-principal";
import { idempotencyMiddleware } from "./idempotency";
import * as idempotencyRepo from "./idempotency-repo";

function fixture(prefix = "/api/v1") {
	const store = sqliteD1();
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.onError((error) => toErrorResponse(error, "test"));
	app.use("*", async (c, next) => {
		c.set("apiKey", testApiPrincipal());
		await next();
	});
	app.use("*", idempotencyMiddleware(prefix));
	const patch = (slug: string, body: object, headers: Record<string, string> = {}) =>
		app.request(
			`${prefix}/spaces/${slug}`,
			{ method: "PATCH", headers, body: JSON.stringify(body) },
			{ DB: store.db } as Env,
		);
	const state = () =>
		[
			"spaces",
			"space_slug_aliases",
			"changes",
			"idempotency_records",
			"idempotency_response_chunks",
		].map((table) => store.sqlite.prepare(`SELECT * FROM ${table}`).all());
	return { ...store, app, patch, state };
}

afterEach(() => vi.restoreAllMocks());

describe("space PATCH idempotent ETags", () => {
	it.each(["/api/v1", "/custom/v1"])(
		"replays the saved ETag and exact body under %s after the current space changes",
		async (prefix) => {
			const f = fixture(prefix);
			try {
				f.app.route(`${prefix}/spaces`, spacesRoutes());
				const headers = { "Idempotency-Key": "rename", "If-Match": '"0"' };
				const body = { slug: "renamed", name: "Saved name" };
				const first = await f.patch("kb", body, headers);
				expect(first.status).toBe(200);
				const saved = await first.text();
				const etag = `"${Date.parse(JSON.parse(saved).updated_at)}"`;
				expect(first.headers.get("ETag")).toBe(etag);
				const changed = await f.patch("renamed", { slug: "latest", name: "Current name" });
				expect(changed.status).toBe(200);
				expect(changed.headers.get("ETag")).not.toBe(etag);
				const before = f.state();
				const batch = vi.spyOn(f.db, "batch");
				const replay = await f.patch("kb", body, headers);
				expect(replay.status).toBe(200);
				expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
				expect(replay.headers.get("ETag")).toBe(etag);
				expect([null, String(new TextEncoder().encode(saved).byteLength)]).toContain(
					replay.headers.get("Content-Length"),
				);
				expect(await replay.text()).toBe(saved);
				expect(batch).not.toHaveBeenCalled();
				expect(f.state()).toEqual(before);
			} finally {
				f.sqlite.close();
			}
		},
	);

	it.each([false, true])(
		"recovers the winner's ETag and body after a commit race with If-Match=%s without mutating newer state",
		async (conditional) => {
			const f = fixture();
			try {
				let losingStatus: number | undefined;
				let losingLength: number | undefined;
				f.app.use("*", async (c, next) => {
					await next();
					losingStatus = c.res.status;
					losingLength = Number(c.res.headers.get("Content-Length"));
				});
				f.app.route("/api/v1/spaces", spacesRoutes());
				const headers = {
					"Idempotency-Key": "rename",
					...(conditional ? { "If-Match": '"0"' } : {}),
				};
				const body = { slug: "winner" };
				const winner = await f.patch("kb", body, headers);
				expect(winner.status).toBe(200);
				const saved = await winner.text();
				const savedLength = new TextEncoder().encode(saved).byteLength;
				expect(winner.headers.get("Content-Length")).toBe(String(savedLength));
				const etag = winner.headers.get("ETag");
				expect(etag).toBe(`"${Date.parse(JSON.parse(saved).updated_at)}"`);
				const changed = await f.patch("winner", {
					slug: "latest",
					name: "Current name".repeat(8),
					description: "Current description".repeat(64),
				});
				expect(changed.status).toBe(200);
				expect(changed.headers.get("ETag")).not.toBe(etag);
				const before = f.state();
				vi.spyOn(idempotencyRepo, "readIdempotencyResponse").mockResolvedValueOnce(null);
				const batch = vi.spyOn(f.db, "batch");
				const recovered = await f.patch("kb", body, headers);
				expect(recovered.status).toBe(200);
				expect(recovered.headers.get("Idempotent-Replayed")).toBe("true");
				expect(recovered.headers.get("ETag")).toBe(etag);
				expect(losingStatus).toBe(conditional ? 412 : 200);
				if (conditional) expect(losingLength).toBeLessThan(savedLength);
				else expect(losingLength).toBeGreaterThan(savedLength);
				expect([null, String(savedLength)]).toContain(recovered.headers.get("Content-Length"));
				expect(await recovered.text()).toBe(saved);
				expect(batch).toHaveBeenCalledTimes(1);
				await expect(batch.mock.results[0]?.value).rejects.toThrow();
				expect(f.state()).toEqual(before);
			} finally {
				f.sqlite.close();
			}
		},
	);

	it("does not retain the losing PATCH's ETag or Content-Length when recovering a saved failure", async () => {
		const f = fixture();
		try {
			let attempts = 0;
			f.app.patch("/api/v1/spaces/kb", () =>
				++attempts === 1
					? jsonOk({ error: { code: "version_conflict" } }, 412)
					: jsonOk(
							{ updated_at: "2026-10-20T00:00:00.000Z", name: "Longer name".repeat(16) },
							200,
							{ ETag: '"1792454400000"' },
						),
			);
			const headers = { "Idempotency-Key": "failure" };
			const first = await f.patch("kb", {}, headers);
			expect(first.status).toBe(412);
			const saved = await first.text();
			const before = f.state();
			vi.spyOn(idempotencyRepo, "readIdempotencyResponse").mockResolvedValueOnce(null);
			const recovered = await f.patch("kb", {}, headers);
			expect(attempts).toBe(2);
			expect(recovered.status).toBe(412);
			expect(recovered.headers.get("Idempotent-Replayed")).toBe("true");
			expect(recovered.headers.get("ETag")).toBeNull();
			expect([null, String(new TextEncoder().encode(saved).byteLength)]).toContain(
				recovered.headers.get("Content-Length"),
			);
			expect(await recovered.text()).toBe(saved);
			expect(f.state()).toEqual(before);
		} finally {
			f.sqlite.close();
		}
	});

	it.each([
		["PATCH", "/api/v1/spaces/kb", 400, '{"updated_at":"2026-10-20T00:00:00.000Z"}'],
		["PATCH", "/api/v1/spaces/kb", 412, '{"updated_at":"2026-10-20T00:00:00.000Z"}'],
		["PATCH", "/api/v1/spaces/kb", 500, '{"updated_at":"2026-10-20T00:00:00.000Z"}'],
		["PATCH", "/api/v1/widgets/kb", 200, '{"updated_at":"2026-10-20T00:00:00.000Z"}'],
		["PATCH", "/api/v1/spaces/kb/nested", 200, '{"updated_at":"2026-10-20T00:00:00.000Z"}'],
		["POST", "/api/v1/spaces", 201, '{"updated_at":"2026-10-20T00:00:00.000Z"}'],
		["DELETE", "/api/v1/spaces/kb", 200, '{"updated_at":"2026-10-20T00:00:00.000Z"}'],
		["PATCH", "/api/v1/spaces/kb", 200, '{"updated_at":"invalid"}'],
		["PATCH", "/api/v1/spaces/kb", 200, '{"updated_at":123}'],
		["PATCH", "/api/v1/spaces/kb", 200, "{}"],
		["PATCH", "/api/v1/spaces/kb", 200, "null"],
		["PATCH", "/api/v1/spaces/kb", 200, "not-json"],
	] as const)(
		"does not add an ETag to %s %s with status %s and body %s",
		async (method, path, status, body) => {
			const f = fixture();
			try {
				f.app.on(method, path, (c) => c.body(body, status));
				const request = () =>
					f.app.request(path, { method, headers: { "Idempotency-Key": "same" } }, {
						DB: f.db,
					} as Env);
				expect((await request()).status).toBe(status);
				const replay = await request();
				expect(replay.status).toBe(status);
				expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
				expect(replay.headers.get("ETag")).toBeNull();
				expect(await replay.text()).toBe(body);
			} finally {
				f.sqlite.close();
			}
		},
	);
});
