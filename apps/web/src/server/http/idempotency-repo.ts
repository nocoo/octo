import { ApiError } from "../lib/errors";
import { responseChunks } from "./idempotency-storage";

export type IdempotencyRecord = {
	request_hash: string;
	status: number;
	response_json: string;
};

export async function findIdempotencyRecord(
	db: D1Database,
	keyId: string,
	idemKey: string,
): Promise<IdempotencyRecord | null> {
	return db
		.prepare(
			"SELECT request_hash, status, response_json FROM idempotency_records WHERE key_id = ? AND idem_key = ?",
		)
		.bind(keyId, idemKey)
		.first<IdempotencyRecord>();
}

export async function readIdempotencyResponse(
	db: D1Database,
	keyId: string,
	idemKey: string,
	hash: string,
): Promise<{ status: number; body: string } | null> {
	const row = await findIdempotencyRecord(db, keyId, idemKey);
	if (!row) return null;
	if (row.request_hash !== hash)
		throw new ApiError("idempotency_conflict", "idempotency key reused with different request");
	const count = Number(row.response_json);
	if (row.status < 200 || !Number.isSafeInteger(count) || count < 1)
		throw new ApiError("unavailable", "idempotency outcome unavailable");
	const chunks = await db
		.prepare(
			"SELECT chunk_index, body FROM idempotency_response_chunks WHERE key_id = ? AND idem_key = ? ORDER BY chunk_index",
		)
		.bind(keyId, idemKey)
		.all<{ chunk_index: number; body: string }>();
	if (chunks.results.length !== count || chunks.results.some((chunk, i) => chunk.chunk_index !== i))
		throw new ApiError("unavailable", "idempotency response incomplete");
	return { status: row.status, body: chunks.results.map((chunk) => chunk.body).join("") };
}

export async function commitIdempotencyOutcome(
	db: D1Database,
	keyId: string,
	idemKey: string,
	hash: string,
	status: number,
	body: string,
	writes: D1PreparedStatement[],
): Promise<void> {
	const chunks = responseChunks(body);
	await db.batch([
		db
			.prepare(
				"INSERT INTO idempotency_records (key_id, idem_key, request_hash, status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.bind(keyId, idemKey, hash, status, String(chunks.length), Date.now()),
		...writes,
		...chunks.map((chunk, i) =>
			db
				.prepare(
					"INSERT INTO idempotency_response_chunks (key_id, idem_key, chunk_index, body) VALUES (?, ?, ?, ?)",
				)
				.bind(keyId, idemKey, i, chunk),
		),
	]);
}

export async function purgeIdempotencyOlderThan(db: D1Database, cutoffMs: number): Promise<number> {
	const result = await db
		.prepare("DELETE FROM idempotency_records WHERE created_at < ? AND status >= 200")
		.bind(cutoffMs)
		.run();
	return result.meta.changes ?? 0;
}
