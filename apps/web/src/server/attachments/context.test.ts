import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppVars, Env } from "../env";
import { attachmentService, publicOriginFromRequest } from "./context";

describe("attachment context", () => {
	it("prefers configured public host", async () => {
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.get("/x", (c) => c.json({ origin: publicOriginFromRequest(c) }));
		const res = await app.request(
			"http://127.0.0.1:1/x",
			{},
			{
				DB: {} as D1Database,
				FILES: {} as R2Bucket,
				ASSETS: {} as Fetcher,
				ATTACHMENT_URL_SECRET: "s",
				ATTACHMENT_URL_HOST: "https://cdn.example/",
			},
		);
		expect(await res.json()).toEqual({ origin: "https://cdn.example" });
	});

	it("falls back to request origin", async () => {
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.get("/x", (c) => c.json({ origin: publicOriginFromRequest(c) }));
		const res = await app.request(
			"https://octo.dev.hexly.ai/x",
			{},
			{
				DB: {} as D1Database,
				FILES: {} as R2Bucket,
				ASSETS: {} as Fetcher,
				ATTACHMENT_URL_SECRET: "s",
			},
		);
		expect(await res.json()).toEqual({ origin: "https://octo.dev.hexly.ai" });
	});

	it("requires url secret", () => {
		expect(() =>
			attachmentService({
				env: { DB: {} as D1Database, FILES: {} as R2Bucket, ASSETS: {} as Fetcher },
				req: { url: "http://x" },
			} as never),
		).toThrow("missing ATTACHMENT_URL_SECRET");
	});

	it("builds attachment service", async () => {
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.get("/x", (c) => {
			const svc = attachmentService(c);
			return c.json({ name: svc.constructor.name });
		});
		const res = await app.request(
			"http://127.0.0.1/x",
			{},
			{
				DB: {} as D1Database,
				FILES: {} as R2Bucket,
				ASSETS: {} as Fetcher,
				ATTACHMENT_URL_SECRET: "s",
			},
		);
		expect(await res.json()).toEqual({ name: "AttachmentService" });
	});
});
