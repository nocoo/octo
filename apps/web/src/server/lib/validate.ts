import type { ZodType } from "zod";
import { MEMORY_BODY_MAX_BYTES } from "../../lib/schema/memory";
import { ApiError } from "./errors";

export const JSON_BODY_MAX_BYTES = 6 * MEMORY_BODY_MAX_BYTES + 100_000;

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw new ApiError("validation_failed", "invalid json");
	}
}

export async function readJsonLimited(
	request: Request,
	maxBytes = JSON_BODY_MAX_BYTES,
): Promise<unknown> {
	const header = request.headers.get("content-length");
	if (header && Number(header) > maxBytes) {
		throw new ApiError("payload_too_large", "payload too large");
	}
	const reader = request.body?.getReader();
	if (!reader) {
		throw new ApiError("validation_failed", "invalid json");
	}
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new ApiError("payload_too_large", "payload too large");
			}
			chunks.push(decoder.decode(value, { stream: true }));
		}
		chunks.push(decoder.decode());
	} finally {
		reader.releaseLock();
	}
	try {
		return JSON.parse(chunks.join("")) as unknown;
	} catch {
		throw new ApiError("validation_failed", "invalid json");
	}
}

export function parseStrict<T>(schema: ZodType<T>, data: unknown): T {
	const result = schema.safeParse(data);
	if (result.success) {
		return result.data;
	}
	throw new ApiError("validation_failed", "schema validation failed", {
		issues: result.error.issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
		})),
	});
}
