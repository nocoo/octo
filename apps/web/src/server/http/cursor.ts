import { ApiError } from "../lib/errors";
import { base64UrlDecode, base64UrlEncode } from "./base64url";
import { hmacSha256Base64Url, timingSafeEqual } from "./crypto";

const VERSION = "c1";

export type CursorPayload = Record<string, unknown>;

export async function encodeCursor(secret: string, payload: CursorPayload): Promise<string> {
	const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
	const mac = await hmacSha256Base64Url(secret, `${VERSION}:${body}`);
	return `${VERSION}.${body}.${mac}`;
}

export async function decodeCursor(secret: string, cursor: string): Promise<CursorPayload> {
	const parts = cursor.split(".");
	if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) {
		throw new ApiError("validation_failed", "invalid cursor");
	}
	const expected = await hmacSha256Base64Url(secret, `${VERSION}:${parts[1]}`);
	if (!timingSafeEqual(expected, parts[2])) {
		throw new ApiError("validation_failed", "invalid cursor");
	}
	try {
		const json = new TextDecoder().decode(base64UrlDecode(parts[1]));
		const parsed = JSON.parse(json) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new ApiError("validation_failed", "invalid cursor");
		}
		return parsed as CursorPayload;
	} catch (err) {
		if (err instanceof ApiError) {
			throw err;
		}
		throw new ApiError("validation_failed", "invalid cursor");
	}
}

export function cursorSecretFromEnv(env: { API_KEY_PEPPER?: string }): string {
	const pepper = env.API_KEY_PEPPER?.trim();
	if (!pepper) {
		throw new ApiError("internal", "cursor secret missing");
	}
	return pepper;
}
