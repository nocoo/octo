import { ApiError } from "../lib/errors";
import type { BlobStore } from "../ports/blob";
import { attachmentDisposition } from "./disposition";
import { isExpired, verifyAttachmentUrlSig } from "./url-sign";

export type FileDownloadDeps = {
	blobs: BlobStore;
	urlSecret: string;
	nowSeconds?: () => number;
};

export async function streamSignedFile(
	deps: FileDownloadDeps,
	r2Key: string,
	expRaw: string | undefined,
	sig: string | undefined,
	filenameHint?: string,
): Promise<Response> {
	if (!expRaw || !sig) {
		throw new ApiError("unauthenticated", "invalid signature");
	}
	const exp = Number.parseInt(expRaw, 10);
	if (!Number.isFinite(exp)) {
		throw new ApiError("unauthenticated", "invalid signature");
	}
	const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
	if (isExpired(exp, now)) {
		throw new ApiError("unauthenticated", "expired signature");
	}
	if (!(await verifyAttachmentUrlSig(deps.urlSecret, r2Key, exp, sig))) {
		throw new ApiError("unauthenticated", "invalid signature");
	}
	const obj = await deps.blobs.get(r2Key);
	if (!obj) {
		throw new ApiError("not_found", "not found");
	}
	const filename = filenameHint ?? r2Key.split("/").at(-1) ?? "file";
	return new Response(obj.body, {
		status: 200,
		headers: {
			"content-type": obj.contentType,
			"content-disposition": attachmentDisposition(filename, obj.contentType),
			etag: `"${obj.sha256}"`,
			"cache-control": "private, max-age=0",
		},
	});
}
