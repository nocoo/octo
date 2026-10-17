import { ApiError } from "../lib/errors";
import { base64UrlDecode, base64UrlEncode } from "./base64url";
import { hmacSha256Base64Url, timingSafeEqual } from "./crypto";

const VERSION = 1;

type CursorWire = { v: number; p: string; m: string };

export type CursorPayload = Record<string, unknown>;

export async function encodeCursor(secret: string, payload: CursorPayload): Promise<string> {
	const p = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
	const m = await hmacSha256Base64Url(secret, `${VERSION}:${p}`);
	const wire: CursorWire = { v: VERSION, p, m };
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(wire)));
}

export async function decodeCursor(secret: string, cursor: string): Promise<CursorPayload> {
	let wire: CursorWire;
	try {
		const json = new TextDecoder().decode(base64UrlDecode(cursor));
		wire = JSON.parse(json) as CursorWire;
	} catch {
		throw new ApiError("validation_failed", "invalid cursor");
	}
	if (wire.v !== VERSION || typeof wire.p !== "string" || typeof wire.m !== "string") {
		throw new ApiError("validation_failed", "invalid cursor");
	}
	const expected = await hmacSha256Base64Url(secret, `${VERSION}:${wire.p}`);
	if (!timingSafeEqual(expected, wire.m)) {
		throw new ApiError("validation_failed", "invalid cursor");
	}
	try {
		const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(wire.p))) as unknown;
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
