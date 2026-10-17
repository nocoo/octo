import {
	decodeIdempotencyResponse,
	encodeIdempotencyResponse,
	IDEMPOTENCY_PENDING_STATUS,
	isIdempotencyRecordComplete,
} from "./idempotency-storage";

export type IdempotencyRecord = {
	key_id: string;
	idem_key: string;
	request_hash: string;
	status: number;
	response_json: string;
	created_at: number;
};

export type IdempotencyClaim =
	| { kind: "claimed" }
	| { kind: "replay"; status: number; body: string }
	| { kind: "conflict" };

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

export async function claimIdempotencyKey(
	db: D1Database,
	keyId: string,
	idemKey: string,
	requestHash: string,
	createdAt: number,
): Promise<IdempotencyClaim> {
	try {
		const insert = await db
			.prepare(
				`INSERT INTO idempotency_records (key_id, idem_key, request_hash, status, response_json, created_at)
       VALUES (?, ?, ?, ?, '', ?)`,
			)
			.bind(keyId, idemKey, requestHash, IDEMPOTENCY_PENDING_STATUS, createdAt)
			.run();
		if ((insert.meta.changes ?? 0) > 0) {
			return { kind: "claimed" };
		}
	} catch {
		// D1 may throw on PRIMARY KEY conflict instead of reporting changes: 0.
	}
	return interpretExisting(await findIdempotencyRecord(db, keyId, idemKey), requestHash);
}

function interpretExisting(row: IdempotencyRecord | null, requestHash: string): IdempotencyClaim {
	if (!row) {
		return { kind: "conflict" };
	}
	if (row.request_hash !== requestHash) {
		return { kind: "conflict" };
	}
	if (isIdempotencyRecordComplete(row.status, row.response_json)) {
		return {
			kind: "replay",
			status: row.status,
			body: decodeIdempotencyResponse(row.response_json),
		};
	}
	return { kind: "conflict" };
}

export async function waitForIdempotencyReplay(
	db: D1Database,
	keyId: string,
	idemKey: string,
	requestHash: string,
	timeoutMs = 5_000,
	intervalMs = 25,
): Promise<IdempotencyClaim> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const row = await findIdempotencyRecord(db, keyId, idemKey);
		const claim = interpretExisting(row, requestHash);
		if (claim.kind === "replay") {
			return claim;
		}
		if (claim.kind === "conflict" && row && row.request_hash !== requestHash) {
			return claim;
		}
		if (row && isIdempotencyRecordComplete(row.status, row.response_json)) {
			return interpretExisting(row, requestHash);
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return { kind: "conflict" };
}

export async function completeIdempotencyRecord(
	db: D1Database,
	keyId: string,
	idemKey: string,
	requestHash: string,
	status: number,
	responseBody: string,
): Promise<void> {
	const responseJson = encodeIdempotencyResponse(responseBody);
	const result = await db
		.prepare(
			`UPDATE idempotency_records
       SET status = ?, response_json = ?
       WHERE key_id = ? AND idem_key = ? AND request_hash = ? AND status = ?`,
		)
		.bind(status, responseJson, keyId, idemKey, requestHash, IDEMPOTENCY_PENDING_STATUS)
		.run();
	if ((result.meta.changes ?? 0) === 0) {
		throw new Error("idempotency completion lost race");
	}
}

export async function releaseIdempotencyClaim(
	db: D1Database,
	keyId: string,
	idemKey: string,
	requestHash: string,
): Promise<void> {
	await db
		.prepare(
			`DELETE FROM idempotency_records
       WHERE key_id = ? AND idem_key = ? AND request_hash = ? AND status = ?`,
		)
		.bind(keyId, idemKey, requestHash, IDEMPOTENCY_PENDING_STATUS)
		.run();
}

export async function purgeIdempotencyOlderThan(db: D1Database, cutoffMs: number): Promise<number> {
	const result = await db
		.prepare("DELETE FROM idempotency_records WHERE created_at < ?")
		.bind(cutoffMs)
		.run();
	return result.meta.changes ?? 0;
}
