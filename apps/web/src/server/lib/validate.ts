import type { ZodType } from "zod";
import { ApiError } from "./errors";

export const JSON_BODY_MAX_BYTES = 1_100_000;

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
	const buf = await request.arrayBuffer();
	if (buf.byteLength > maxBytes) {
		throw new ApiError("payload_too_large", "payload too large");
	}
	try {
		return JSON.parse(new TextDecoder().decode(buf)) as unknown;
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
