import { z } from "zod";
import { ApiError } from "../lib/errors";
import { parseStrict } from "../lib/validate";

export const memoryCursorSchema = z.strictObject({
	u: z.number().int(),
	i: z.string().min(1),
});

export const changeCursorSchema = z.strictObject({
	s: z.number().int().nonnegative(),
});

export type MemoryCursor = z.infer<typeof memoryCursorSchema>;
export type ChangeCursor = z.infer<typeof changeCursorSchema>;

export function encodeCursor(payload: unknown): string {
	const json = JSON.stringify(payload);
	const bytes = new TextEncoder().encode(json);
	let bin = "";
	for (const byte of bytes) {
		bin += String.fromCharCode(byte);
	}
	return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeCursor(raw: string): unknown {
	try {
		const padded = raw.replaceAll("-", "+").replaceAll("_", "/");
		const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
		const bin = atob(padded + pad);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i += 1) {
			bytes[i] = bin.charCodeAt(i);
		}
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch {
		throw new ApiError("validation_failed", "invalid cursor");
	}
}

export function parseMemoryCursor(raw: string): MemoryCursor {
	return parseStrict(memoryCursorSchema, decodeCursor(raw));
}

export function parseChangeCursor(raw: string): ChangeCursor {
	return parseStrict(changeCursorSchema, decodeCursor(raw));
}

export function parseLimit(raw: string | null): number {
	if (raw == null || raw === "") {
		return 50;
	}
	if (!/^\d+$/.test(raw)) {
		throw new ApiError("validation_failed", "invalid limit");
	}
	const n = Number(raw);
	if (n < 1 || n > 200) {
		throw new ApiError("validation_failed", "limit must be 1-200");
	}
	return n;
}
