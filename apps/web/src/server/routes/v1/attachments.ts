import { Hono } from "hono";
import { attachmentService } from "../../attachments/context";
import { parseAttachmentUpload } from "../../attachments/upload";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";

export function createAttachmentsRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.post("/memories/:id/attachments", async (c) => {
		const svc = attachmentService(c);
		await svc.assertUploadAccess(c.get("apiKey"), c.req.param("id"));
		const upload = await parseAttachmentUpload(c.req.raw);
		const body = await svc.upload(c.get("apiKey"), c.req.param("id"), upload);
		return jsonOk(body, 201);
	});

	app.get("/memories/:id/attachments", async (c) => {
		const items = await attachmentService(c).list(c.get("apiKey"), c.req.param("id"));
		return jsonOk({ items });
	});

	app.get("/attachments/:id/url", async (c) => {
		const body = await attachmentService(c).signedUrl(c.get("apiKey"), c.req.param("id"));
		return jsonOk(body);
	});

	app.delete("/attachments/:id", async (c) => {
		await attachmentService(c).delete(c.get("apiKey"), c.req.param("id"));
		return jsonOk({ ok: true });
	});

	return app;
}
