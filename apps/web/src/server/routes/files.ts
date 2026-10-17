import { Hono } from "hono";
import { streamSignedFile } from "../attachments/files";
import type { AppVars, Env } from "../env";
import { createR2BlobStore } from "../ports/blob-r2";

export function createFilesRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/files/*", async (c) => {
		const secret = c.env.ATTACHMENT_URL_SECRET;
		if (!secret) {
			throw new Error("missing ATTACHMENT_URL_SECRET");
		}
		const prefix = "/files/";
		const path = c.req.path;
		if (!path.startsWith(prefix)) {
			return c.notFound();
		}
		const r2Key = decodeURIComponent(path.slice(prefix.length));
		const exp = c.req.query("exp");
		const sig = c.req.query("sig");
		return streamSignedFile(
			{ blobs: createR2BlobStore(c.env.FILES), urlSecret: secret },
			r2Key,
			exp,
			sig,
		);
	});

	return app;
}
