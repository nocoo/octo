import { ApiError } from "../lib/errors";

/** Per D1 row payload; keep each chunk row under SQLite ~2 MB. */
export const IDEMPOTENCY_CHUNK_BYTES = 750_000;

export const IDEMPOTENCY_PENDING_STATUS = -1;
export const IDEMPOTENCY_CHUNK_STATUS = -2;

export const IDEMPOTENCY_CHUNK_MARKER_PREFIX = "@octo/chunks:";

export function chunkRowIdemKey(clientIdemKey: string, index: number): string {
	return `@octo/idempotency-chunk/${index}/${clientIdemKey}`;
}

export function isChunkRowIdemKey(idemKey: string): boolean {
	return idemKey.startsWith("@octo/idempotency-chunk/");
}

export type EncodedIdempotencyResponse =
	| { kind: "inline"; body: string }
	| { kind: "chunked"; chunks: string[]; marker: string };

export function planIdempotencyResponseStorage(body: string): EncodedIdempotencyResponse {
	if (body.length <= IDEMPOTENCY_CHUNK_BYTES) {
		return { kind: "inline", body };
	}
	const chunks: string[] = [];
	for (let i = 0; i < body.length; i += IDEMPOTENCY_CHUNK_BYTES) {
		const part = body.slice(i, i + IDEMPOTENCY_CHUNK_BYTES);
		if (new TextEncoder().encode(part).length > IDEMPOTENCY_CHUNK_BYTES + 1000) {
			throw new ApiError("payload_too_large", "idempotent response chunk too large");
		}
		chunks.push(part);
	}
	return {
		kind: "chunked",
		chunks,
		marker: `${IDEMPOTENCY_CHUNK_MARKER_PREFIX}${chunks.length}`,
	};
}

export function isIdempotencyRecordComplete(status: number, responseJson: string): boolean {
	return (
		status !== IDEMPOTENCY_PENDING_STATUS &&
		status !== IDEMPOTENCY_CHUNK_STATUS &&
		responseJson.length > 0
	);
}

export async function loadIdempotencyResponse(
	db: D1Database,
	keyId: string,
	idemKey: string,
	responseJson: string,
): Promise<string> {
	if (!responseJson.startsWith(IDEMPOTENCY_CHUNK_MARKER_PREFIX)) {
		return responseJson;
	}
	const count = Number.parseInt(responseJson.slice(IDEMPOTENCY_CHUNK_MARKER_PREFIX.length), 10);
	if (!Number.isFinite(count) || count < 1) {
		throw new ApiError("internal", "corrupt idempotency chunk marker");
	}
	const parts: string[] = [];
	for (let i = 0; i < count; i += 1) {
		const row = await db
			.prepare(
				"SELECT response_json FROM idempotency_records WHERE key_id = ? AND idem_key = ? AND status = ?",
			)
			.bind(keyId, chunkRowIdemKey(idemKey, i), IDEMPOTENCY_CHUNK_STATUS)
			.first<{ response_json: string }>();
		if (!row) {
			throw new ApiError("internal", "missing idempotency response chunk");
		}
		parts.push(row.response_json);
	}
	return parts.join("");
}
