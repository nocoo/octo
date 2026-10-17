import { Hono, type MiddlewareHandler } from "hono";
import { attachmentService } from "../../attachments/context";
import { sha256Hex } from "../../attachments/crypto";
import { parseAttachmentUpload } from "../../attachments/upload";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";

export const attachmentUploadPreparation: MiddlewareHandler<{
	Bindings: Env;
	Variables: AppVars;
}> = async (c, next) => {
	if (c.req.method === "POST") {
		await attachmentService(c).assertUploadAccess(c.get("apiKey"), c.req.param("id") ?? "");
		const upload = await parseAttachmentUpload(c.req.raw);
		c.set("attachmentUpload", upload);
		if (c.req.header("Idempotency-Key") !== undefined) {
			c.set(
				"requestHashBody",
				JSON.stringify({
					filename: upload.filename,
					content_type: upload.contentType,
					sha256: await sha256Hex(upload.bytes),
				}),
			);
		}
	}
	await next();
};

export const attachmentDeleteAuthorization: MiddlewareHandler<{
	Bindings: Env;
	Variables: AppVars;
}> = async (c, next) => {
	if (c.req.method === "DELETE") {
		await attachmentService(c).assertDeleteAccess(c.get("apiKey"), c.req.param("id") ?? "");
	}
	await next();
};

export function createAttachmentsRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.post("/memories/:id/attachments", async (c) => {
		const write = await attachmentService(c).upload(
			c.get("apiKey"),
			c.req.param("id"),
			c.get("attachmentUpload"),
		);
		c.get("writeStatements").push(...write.statements);
		c.set("writeError", write.mapError);
		return jsonOk(write.value, 201);
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
		const write = await attachmentService(c).delete(c.get("apiKey"), c.req.param("id"));
		c.get("writeStatements").push(...write.statements);
		c.set("writeError", write.mapError);
		return jsonOk({ ok: true });
	});

	return app;
}
