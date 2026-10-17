import { ApiError } from "../lib/errors";

const PRINTABLE_ASCII = /^[\x20-\x7E]{1,128}$/u;

export function parseIdempotencyKey(header: string | undefined): string | null {
	if (header === undefined) {
		return null;
	}
	if (header.length === 0) {
		throw new ApiError("validation_failed", "invalid Idempotency-Key", {
			issues: [{ path: "Idempotency-Key", message: "must be 1-128 printable ASCII" }],
		});
	}
	if (!PRINTABLE_ASCII.test(header)) {
		throw new ApiError("validation_failed", "invalid Idempotency-Key", {
			issues: [{ path: "Idempotency-Key", message: "must be 1-128 printable ASCII" }],
		});
	}
	return header;
}
