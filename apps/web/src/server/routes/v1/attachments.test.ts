import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../../attachments/content-type";
import type { ApiPrincipal } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { idempotencyMiddleware } from "../../http/idempotency";
import { toErrorResponse } from "../../lib/errors";
import {
	attachmentDeleteAuthorization,
	attachmentUploadPreparation,
	createAttachmentsRoutes,
} from "./attachments";

function principal(): ApiPrincipal {
	return {
		id: "kid",
		name: "n",
		role: "admin",
		ops: new Set(["r", "u", "d"]),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: ["s1"],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
	};
}

function attachmentsApp(key: ApiPrincipal | null = principal()) {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.onError((err) => toErrorResponse(err, "test"));
	if (key) {
		app.use("*", async (c, next) => {
			c.set("apiKey", key);
			c.set("adminEmail", "");
			await next();
		});
	}
	app.use("/api/v1/memories/:id/attachments", attachmentUploadPreparation);
	app.use("/api/v1/attachments/:id", attachmentDeleteAuthorization);
	app.use("*", idempotencyMiddleware());
	app.route("/api/v1", createAttachmentsRoutes());
	return app;
}

function env(): Env {
	const prepare = vi.fn((sql: string) => ({
		bind: (...args: unknown[]) => ({
			first: async () => {
				if (sql.includes("FROM memories")) {
					return {
						id: args[0],
						space_id: "s1",
						source_key_id: "kid",
						deleted_at: null,
					};
				}
				return null;
			},
			all: async () => ({ results: [] }),
			run: async () => ({ meta: { changes: 1 } }),
		}),
	}));
	return {
		DB: { prepare, batch: vi.fn() } as unknown as D1Database,
		FILES: {
			put: vi.fn(),
			get: vi.fn(),
			delete: vi.fn(),
		} as unknown as R2Bucket,
		ASSETS: {} as Fetcher,
		ATTACHMENT_URL_SECRET: "url-secret",
	};
}

describe("attachments routes", () => {
	it("uploads via raw body", async () => {
		const res = await attachmentsApp().request(
			"/api/v1/memories/m1/attachments",
			{
				method: "POST",
				headers: { "Content-Type": "image/png", "X-Filename": "a.png" },
				body: new Uint8Array([1, 2, 3]),
			},
			env(),
		);
		expect(res.status).toBe(201);
	});

	it("authorizes uploads before consuming request bytes", async () => {
		const pull = vi.fn();
		const request = new Request("http://x/api/v1/memories/m1/attachments", {
			method: "POST",
			headers: { "Content-Type": "image/png", "X-Filename": "a.png" },
			body: new ReadableStream({ pull }, { highWaterMark: 0 }),
			duplex: "half",
		} as RequestInit);
		const bindings = env();
		const res = await attachmentsApp({ ...principal(), ops: new Set(["r"]) }).fetch(
			request,
			bindings,
		);
		expect(res.status).toBe(403);
		expect(pull).not.toHaveBeenCalled();
		expect(bindings.FILES.put).not.toHaveBeenCalled();
		await request.body?.cancel();
	});

	it("returns the declared-oversize envelope without aborting the unused upload", async () => {
		const pull = vi.fn();
		const cancel = vi.fn();
		const request = new Request("http://x/api/v1/memories/m1/attachments", {
			method: "POST",
			headers: {
				"Content-Type": "image/png",
				"X-Filename": "big.png",
				"Content-Length": String(MAX_ATTACHMENT_BYTES + 1),
			},
			body: new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
			duplex: "half",
		} as RequestInit);
		const bindings = env();
		const response = await attachmentsApp().fetch(request, bindings);
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: { code: "payload_too_large", message: "attachment too large", request_id: "test" },
		});
		expect(pull).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
		expect(request.bodyUsed).toBe(false);
		expect(bindings.FILES.put).not.toHaveBeenCalled();
		await request.body?.cancel();
	});

	it("lists attachments", async () => {
		const res = await attachmentsApp().request("/api/v1/memories/m1/attachments", {}, env());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [] });
	});
});
