import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { signAttachmentUrl } from "../attachments/url-sign";
import type { AppVars, Env } from "../env";
import { toErrorResponse } from "../lib/errors";
import { createFilesRoutes } from "./files";

function filesApp() {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.onError((err) => toErrorResponse(err, "test"));
	app.route("/", createFilesRoutes());
	return app;
}

describe("files routes", () => {
	it("returns 401 for bad signature", async () => {
		const app = filesApp();
		const res = await app.request(
			"/files/att/m/a?exp=1&sig=bad",
			{},
			{
				DB: {} as D1Database,
				FILES: { get: vi.fn() } as unknown as R2Bucket,
				ASSETS: {} as Fetcher,
				ATTACHMENT_URL_SECRET: "secret",
			},
		);
		expect(res.status).toBe(401);
	});

	it("errors when secret missing", async () => {
		const app = filesApp();
		const res = await app.request(
			"/files/att/m/a",
			{},
			{
				DB: {} as D1Database,
				FILES: {} as R2Bucket,
				ASSETS: {} as Fetcher,
			},
		);
		expect(res.status).toBe(500);
	});

	it("streams signed files", async () => {
		const exp = Math.floor(Date.now() / 1000) + 120;
		const sig = await signAttachmentUrl("secret", "att/m/a", exp);
		const app = filesApp();
		const res = await app.request(
			`/files/att/m/a?exp=${exp}&sig=${sig}`,
			{},
			{
				DB: {} as D1Database,
				FILES: {
					get: vi.fn().mockResolvedValue({
						body: new ReadableStream(),
						customMetadata: { sha256: "h", content_type: "image/png" },
						httpMetadata: { contentType: "image/png" },
						size: 1,
					}),
				} as unknown as R2Bucket,
				ASSETS: {} as Fetcher,
				ATTACHMENT_URL_SECRET: "secret",
			},
		);
		expect(res.status).toBe(200);
	});
});
