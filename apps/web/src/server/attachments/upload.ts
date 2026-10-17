import { ApiError } from "../lib/errors";
import { readLimitedBody } from "./body-limit";
import {
	isAllowedAttachmentType,
	MAX_ATTACHMENT_BYTES,
	normalizeContentType,
} from "./content-type";

export const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export type ParsedUpload = {
	filename: string;
	contentType: string;
	bytes: Uint8Array;
};

function assertType(contentType: string): string {
	const normalized = normalizeContentType(contentType);
	if (!isAllowedAttachmentType(normalized)) {
		throw new ApiError("unsupported_media_type", "unsupported attachment type");
	}
	return normalized;
}

function assertFilename(filename: string): string {
	const trimmed = filename.trim();
	if (!trimmed) {
		throw new ApiError("validation_failed", "filename required");
	}
	return trimmed;
}

function boundedRequest(request: Request, bytes: Uint8Array): Request {
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body: bytes,
	});
}

export async function parseRawUpload(request: Request): Promise<ParsedUpload> {
	const filename = assertFilename(request.headers.get("X-Filename") ?? "");
	const contentType = assertType(request.headers.get("Content-Type") ?? "");
	const bytes = await readLimitedBody(request, MAX_ATTACHMENT_BYTES);
	return { filename, contentType, bytes };
}

export async function parseMultipartUpload(request: Request): Promise<ParsedUpload> {
	const bytes = await readLimitedBody(request, MAX_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES);
	const form = await boundedRequest(request, bytes)
		.formData()
		.catch(() => {
			throw new ApiError("validation_failed", "invalid multipart body");
		});
	const file = form.get("file");
	if (!(file instanceof File) || Array.from(form.keys()).length !== 1) {
		throw new ApiError("validation_failed", "exactly one file field required");
	}
	if (
		file.size > MAX_ATTACHMENT_BYTES ||
		bytes.byteLength - file.size > MAX_MULTIPART_OVERHEAD_BYTES
	) {
		throw new ApiError("payload_too_large", "attachment too large");
	}
	const contentType = assertType(file.type || "application/octet-stream");
	const fileBytes = new Uint8Array(await file.arrayBuffer());
	return { filename: assertFilename(file.name), contentType, bytes: fileBytes };
}

export async function parseAttachmentUpload(request: Request): Promise<ParsedUpload> {
	const contentTypeHeader = request.headers.get("Content-Type") ?? "";
	if (contentTypeHeader.toLowerCase().includes("multipart/form-data")) {
		return parseMultipartUpload(request);
	}
	return parseRawUpload(request);
}
