import { ApiError } from "../lib/errors";

export const TAG_NAME_MAX = 64;

export function normalizeTag(raw: string): string {
	const name = raw
		.trim()
		.normalize("NFKC")
		.replace(/\p{Script=Latin}/gu, (ch) => ch.toLowerCase());
	if (name.length < 1 || name.length > TAG_NAME_MAX) {
		throw new ApiError("validation_failed", "tag name must be 1-64 characters after normalize");
	}
	return name;
}

export function tagDisplayName(raw: string): string {
	const display = raw.trim().normalize("NFKC");
	if (display.length < 1 || display.length > TAG_NAME_MAX) {
		throw new ApiError("validation_failed", "tag name must be 1-64 characters after normalize");
	}
	return display;
}
