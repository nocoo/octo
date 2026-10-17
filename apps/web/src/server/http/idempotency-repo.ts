export type IdempotencyRecord = {
	key_id: string;
	idem_key: string;
	request_hash: string;
	status: number;
	response_json: string;
	created_at: number;
};

export async function findIdempotencyRecord(
	db: D1Database,
	keyId: string,
	idemKey: string,
): Promise<IdempotencyRecord | null> {
	const row = await db
		.prepare(
			"SELECT key_id, idem_key, request_hash, status, response_json, created_at FROM idempotency_records WHERE key_id = ? AND idem_key = ?",
		)
		.bind(keyId, idemKey)
		.first<IdempotencyRecord>();
	return row ?? null;
}

export async function insertIdempotencyRecord(
	db: D1Database,
	record: IdempotencyRecord,
): Promise<boolean> {
	const result = await db
		.prepare(
			"INSERT INTO idempotency_records (key_id, idem_key, request_hash, status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.bind(
			record.key_id,
			record.idem_key,
			record.request_hash,
			record.status,
			record.response_json,
			record.created_at,
		)
		.run();
	return result.success;
}

export async function purgeIdempotencyOlderThan(db: D1Database, cutoffMs: number): Promise<number> {
	const result = await db
		.prepare("DELETE FROM idempotency_records WHERE created_at < ?")
		.bind(cutoffMs)
		.run();
	return result.meta.changes ?? 0;
}
