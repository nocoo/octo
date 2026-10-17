import type { Context } from "hono";
import type { AppVars, Env } from "../env";
import { createR2BlobStore } from "../ports/blob-r2";
import { AttachmentRepo } from "./repo";
import { AttachmentService } from "./service";
import { DEFAULT_ATTACHMENT_URL_TTL_SECONDS } from "./url-sign";

export function publicOriginFromRequest(c: Context<{ Bindings: Env; Variables: AppVars }>): string {
	const configured = c.env.ATTACHMENT_URL_HOST?.trim();
	if (configured) {
		return configured.replace(/\/$/, "");
	}
	const url = new URL(c.req.url);
	return url.origin;
}

export function attachmentService(
	c: Context<{ Bindings: Env; Variables: AppVars }>,
): AttachmentService {
	const secret = c.env.ATTACHMENT_URL_SECRET;
	if (!secret) {
		throw new Error("missing ATTACHMENT_URL_SECRET");
	}
	const repo = new AttachmentRepo({ db: c.env.DB });
	return new AttachmentService({
		repo,
		blobs: createR2BlobStore(c.env.FILES),
		urlSecret: secret,
		publicOrigin: publicOriginFromRequest(c),
		ttlSeconds: DEFAULT_ATTACHMENT_URL_TTL_SECONDS,
	});
}
