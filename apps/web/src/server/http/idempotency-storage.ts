import { ApiError } from "../lib/errors";

/** Stay under D1 SQLite row limit (~2 MB) including JSON overhead. */
export const IDEMPOTENCY_MAX_RESPONSE_BYTES = 1_500_000;
const CHUNK_BYTES = 400_000;

export const IDEMPOTENCY_PENDING_STATUS = -1;

type ChunkedEnvelope = { _chunks: string[] };

function isChunked(value: unknown): value is ChunkedEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		"_chunks" in value &&
		Array.isArray((value as ChunkedEnvelope)._chunks)
	);
}

export function encodeIdempotencyResponse(body: string): string {
	const bytes = new TextEncoder().encode(body).length;
	if (bytes > IDEMPOTENCY_MAX_RESPONSE_BYTES) {
		throw new ApiError("payload_too_large", "idempotent response too large to store");
	}
	if (body.length <= CHUNK_BYTES) {
		return body;
	}
	const chunks: string[] = [];
	for (let i = 0; i < body.length; i += CHUNK_BYTES) {
		chunks.push(body.slice(i, i + CHUNK_BYTES));
	}
	return JSON.stringify({ _chunks: chunks });
}

export function decodeIdempotencyResponse(stored: string): string {
	if (stored.length === 0 || stored[0] !== "{") {
		return stored;
	}
	try {
		const parsed = JSON.parse(stored) as unknown;
		if (isChunked(parsed)) {
			return parsed._chunks.join("");
		}
	} catch {
		// plain json body
	}
	return stored;
}

export function isIdempotencyRecordComplete(status: number, responseJson: string): boolean {
	return status !== IDEMPOTENCY_PENDING_STATUS && responseJson.length > 0;
}
