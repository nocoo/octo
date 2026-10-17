import { ApiError } from "../../lib/errors";

export function parseJsonBody(raw: string): unknown {
	if (raw.length === 0) {
		return {};
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw new ApiError("validation_failed", "invalid json body");
	}
}
