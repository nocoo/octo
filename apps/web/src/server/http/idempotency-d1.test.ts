import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrationSqlForNode } from "../../../../../scripts/sqlite-test";
import {
	claimIdempotencyKey,
	completeIdempotencyRecord,
	releaseIdempotencyClaim,
	waitForIdempotencyReplay,
} from "./idempotency-repo";
import {
	IDEMPOTENCY_CHUNK_MARKER_PREFIX,
	IDEMPOTENCY_CHUNK_STATUS,
	IDEMPOTENCY_PENDING_STATUS,
	isChunkRowIdemKey,
} from "./idempotency-storage";

function sqliteD1(db: DatabaseSync): D1Database {
	const prepare = (sql: string) => {
		const stmt = db.prepare(sql);
		return {
			bind: (...params: Array<string | number | null>) => ({
				run: async () => {
					try {
						const info = stmt.run(...params);
						return { success: true, meta: { changes: info.changes } };
					} catch {
						return { success: false, meta: { changes: 0 } };
					}
				},
				first: async () => (stmt.get(...params) as Record<string, unknown> | undefined) ?? null,
			}),
		};
	};
	return {
		prepare,
		batch: async (statements: Array<{ run: () => Promise<{ meta: { changes?: number } }> }>) => {
			const results = [];
			for (const statement of statements) {
				results.push(await statement.run());
			}
			return results;
		},
	} as unknown as D1Database;
}

function idempotencyTableOnly(db: DatabaseSync): void {
	const core = readFileSync(join(process.cwd(), "migrations/0001_core.sql"), "utf8");
	const sql = migrationSqlForNode(core);
	const match = /CREATE TABLE idempotency_records[\s\S]*?;/u.exec(sql);
	if (!match) {
		throw new Error("idempotency_records migration missing");
	}
	db.exec(match[0]);
}

describe("idempotency repo on sqlite", () => {
	it("allows only one concurrent claim for the same key", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		const claims = await Promise.all(
			Array.from({ length: 16 }, () =>
				claimIdempotencyKey(d1, "key-a", "idem-1", "hash-same", 1_000),
			),
		);
		const winners = claims.filter((c) => c.kind === "claimed");
		const waiters = claims.filter((c) => c.kind === "in_progress");
		expect(winners).toHaveLength(1);
		expect(waiters).toHaveLength(15);
		db.close();
	});

	it("replays after the winner completes and rejects hash mismatch", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		const first = await claimIdempotencyKey(d1, "key-a", "idem-2", "hash-a", 2_000);
		expect(first.kind).toBe("claimed");
		const mismatch = await claimIdempotencyKey(d1, "key-a", "idem-2", "hash-b", 2_001);
		expect(mismatch.kind).toBe("conflict");
		await completeIdempotencyRecord(d1, "key-a", "idem-2", "hash-a", 201, '{"ok":true}', 2_000);
		const replay = await claimIdempotencyKey(d1, "key-a", "idem-2", "hash-a", 2_002);
		expect(replay).toEqual({ kind: "replay", status: 201, body: '{"ok":true}' });
		const stillConflict = await claimIdempotencyKey(d1, "key-a", "idem-2", "hash-b", 2_003);
		expect(stillConflict.kind).toBe("conflict");
		db.close();
	});

	it("waitForIdempotencyReplay resolves when a pending claim completes", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		expect(await claimIdempotencyKey(d1, "key-a", "idem-3", "hash", 3_000)).toEqual({
			kind: "claimed",
		});
		const waiter = waitForIdempotencyReplay(d1, "key-a", "idem-3", "hash");
		await new Promise((resolve) => setTimeout(resolve, 40));
		await completeIdempotencyRecord(d1, "key-a", "idem-3", "hash", 200, '{"hits":1}', 3_000);
		expect(await waiter).toEqual({ kind: "replay", status: 200, body: '{"hits":1}' });
		db.close();
	});

	it("isolates idempotency keys across api keys", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		expect(await claimIdempotencyKey(d1, "key-1", "shared", "hash", 4_000)).toEqual({
			kind: "claimed",
		});
		expect(await claimIdempotencyKey(d1, "key-2", "shared", "hash", 4_001)).toEqual({
			kind: "claimed",
		});
		const row = db
			.prepare("SELECT COUNT(*) AS n FROM idempotency_records WHERE idem_key = 'shared'")
			.get() as { n: number };
		expect(row.n).toBe(2);
		db.close();
	});

	it("stores chunked responses across multiple rows and replays them", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		const body = "x".repeat(1_600_000);
		expect(await claimIdempotencyKey(d1, "key-a", "big", "hash", 5_000)).toEqual({
			kind: "claimed",
		});
		await completeIdempotencyRecord(d1, "key-a", "big", "hash", 200, body, 5_000);
		const main = db
			.prepare(
				"SELECT status, response_json FROM idempotency_records WHERE key_id = 'key-a' AND idem_key = 'big'",
			)
			.get() as { status: number; response_json: string };
		expect(main.status).toBe(200);
		expect(main.response_json.startsWith(IDEMPOTENCY_CHUNK_MARKER_PREFIX)).toBe(true);
		const chunkRows = db
			.prepare("SELECT idem_key, status FROM idempotency_records WHERE key_id = 'key-a'")
			.all() as Array<{ idem_key: string; status: number }>;
		const chunks = chunkRows.filter((row) => isChunkRowIdemKey(row.idem_key));
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((row) => row.status === IDEMPOTENCY_CHUNK_STATUS)).toBe(true);
		const replay = await claimIdempotencyKey(d1, "key-a", "big", "hash", 5_001);
		expect(replay).toEqual({ kind: "replay", status: 200, body });
		db.close();
	});

	it("stops waiting when the stored hash does not match", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		expect(await claimIdempotencyKey(d1, "key-a", "idem-4", "hash-a", 4_000)).toEqual({
			kind: "claimed",
		});
		await completeIdempotencyRecord(d1, "key-a", "idem-4", "hash-a", 200, "{}", 4_000);
		expect(await waitForIdempotencyReplay(d1, "key-a", "idem-4", "hash-b", 200, 10)).toEqual({
			kind: "conflict",
		});
		db.close();
	});

	it("returns in_progress when wait times out on a pending claim", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		expect(await claimIdempotencyKey(d1, "key-a", "slow", "hash", 7_000)).toEqual({
			kind: "claimed",
		});
		expect(await waitForIdempotencyReplay(d1, "key-a", "slow", "hash", 60, 10)).toEqual({
			kind: "in_progress",
		});
		db.close();
	});

	it("treats incomplete non-pending rows as conflict", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		db.prepare(
			`INSERT INTO idempotency_records (key_id, idem_key, request_hash, status, response_json, created_at)
       VALUES ('key-a', 'broken', 'hash', 200, '', 1)`,
		).run();
		expect(await claimIdempotencyKey(d1, "key-a", "broken", "hash", 2)).toEqual({
			kind: "conflict",
		});
		db.close();
	});

	it("releases a pending claim without touching completed rows", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		expect(await claimIdempotencyKey(d1, "key-a", "rel", "hash", 8_000)).toEqual({
			kind: "claimed",
		});
		await releaseIdempotencyClaim(d1, "key-a", "rel", "hash");
		const count = db
			.prepare("SELECT COUNT(*) AS n FROM idempotency_records WHERE idem_key = 'rel'")
			.get() as { n: number };
		expect(count.n).toBe(0);
		db.close();
	});

	it("uses pending status while in flight", async () => {
		const db = new DatabaseSync(":memory:");
		idempotencyTableOnly(db);
		const d1 = sqliteD1(db);
		await claimIdempotencyKey(d1, "key-a", "pending", "hash", 6_000);
		const row = db
			.prepare("SELECT status, response_json FROM idempotency_records WHERE idem_key = 'pending'")
			.get() as { status: number; response_json: string };
		expect(row.status).toBe(IDEMPOTENCY_PENDING_STATUS);
		expect(row.response_json).toBe("");
		db.close();
	});
});
