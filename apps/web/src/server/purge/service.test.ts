import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import { authzFrom, MemoryService } from "../services/memories";
import { cleanupExternalFiles, purgeMemory } from "./service";

async function fixture(trashed = true) {
	const { db, sqlite } = sqliteD1();
	sqlite.exec("PRAGMA foreign_keys = ON");
	const service = new MemoryService(db);
	const authz = authzFrom({
		id: "admin:owner@local",
		actor: "admin:owner@local",
		name: "owner@local",
		role: "admin",
		ops: new Set(["r", "w", "u", "d"]),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: [],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
	});
	const { id } = await service.create(authz, {
		space: "kb",
		title: "title",
		body: "body",
		type: "note",
		tags: ["keep-global-tag"],
	});
	const memoryId = String(id);
	if (trashed) await service.remove(authz, memoryId);
	sqlite
		.prepare(`INSERT INTO memory_vectors (memory_id, profile_id, embedding_model, dim, vector, content_hash, updated_at)
		VALUES (?, 'te3-small-1536', 'text-embedding-3-small', 1536, x'00000000', 'hash', 1)`)
		.run(memoryId);
	for (const [attachment, deleted] of [
		["a1", null],
		["a2", 1],
	] as const)
		sqlite
			.prepare(`INSERT INTO attachments (id, memory_id, r2_key, filename, content_type, size_bytes, sha256, created_by, created_at, deleted_at)
			VALUES (?, ?, ?, 'image.png', 'image/png', 4, 'hash', 'admin:owner@local', 1, ?)`)
			.run(attachment, memoryId, `files/${attachment}`, deleted);
	sqlite.exec(`INSERT INTO audit_log (id, at, actor, method, route, status, request_id, duration_ms)
		VALUES ('audit-kept', 1, 'admin:owner@local', 'DELETE', '/api/admin/trash/:id', 200, 'request', 1)`);
	const files = { delete: vi.fn().mockResolvedValue(undefined) };
	const env = { DB: db, FILES: files } as unknown as Env;
	return { db, sqlite, memoryId, env, files };
}

describe("transactional admin purge", () => {
	it("removes all owned D1 data but retains audit and durable file jobs until cleanup", async () => {
		const { db, sqlite, memoryId, env, files } = await fixture();
		const batch = vi.spyOn(db, "batch");
		expect(await purgeMemory(db, memoryId, "admin:owner@local")).toEqual({
			id: memoryId,
			purged: true,
		});
		expect(batch).toHaveBeenCalledTimes(1);
		expect(files.delete).not.toHaveBeenCalled();
		for (const table of [
			"memories",
			"memory_versions",
			"memory_tags",
			"memory_vectors",
			"attachments",
			"memories_fts",
			"memories_fts_map",
		])
			expect(sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
		expect(sqlite.prepare("SELECT * FROM audit_log").all()).toHaveLength(1);
		expect(sqlite.prepare("SELECT * FROM tags").all()).toHaveLength(1);
		expect(
			sqlite.prepare("SELECT op, actor, entity_id FROM changes WHERE op = 'purged'").get(),
		).toEqual({
			op: "purged",
			actor: "admin:owner@local",
			entity_id: memoryId,
		});
		expect(sqlite.prepare("SELECT * FROM external_file_cleanup_jobs").all()).toHaveLength(2);
		await cleanupExternalFiles(env);
		expect(files.delete.mock.calls).toEqual([["files/a1"], ["files/a2"]]);
		expect(sqlite.prepare("SELECT * FROM external_file_cleanup_jobs").all()).toEqual([]);
		await cleanupExternalFiles(env);
		expect(files.delete).toHaveBeenCalledTimes(2);
	});

	it("rejects live and missing memories", async () => {
		const { db, memoryId, files } = await fixture(false);
		await expect(purgeMemory(db, memoryId, "admin:owner@local")).rejects.toMatchObject({
			status: 409,
		});
		await expect(purgeMemory(db, "missing", "admin:owner@local")).rejects.toMatchObject({
			status: 404,
		});
		expect(files.delete).not.toHaveBeenCalled();
	});

	it.each(["restore", "version", "retrash", "missing"])(
		"atomically rejects a concurrent %s before any deletion",
		async (change) => {
			const { db, sqlite, memoryId, files } = await fixture();
			const batch = db.batch.bind(db);
			vi.spyOn(db, "batch").mockImplementationOnce(async (statements) => {
				if (change === "restore")
					sqlite.prepare("UPDATE memories SET deleted_at = NULL WHERE id = ?").run(memoryId);
				if (change === "version")
					sqlite.prepare("UPDATE memories SET version = version + 1 WHERE id = ?").run(memoryId);
				if (change === "retrash")
					sqlite
						.prepare("UPDATE memories SET deleted_at = deleted_at + 1 WHERE id = ?")
						.run(memoryId);
				if (change === "missing") {
					sqlite.exec("PRAGMA foreign_keys = OFF");
					sqlite.prepare("DELETE FROM memories WHERE id = ?").run(memoryId);
				}
				return batch(statements);
			});
			await expect(purgeMemory(db, memoryId, "admin:owner@local")).rejects.toMatchObject({
				status: change === "missing" ? 404 : 409,
			});
			expect(sqlite.prepare("SELECT * FROM external_file_cleanup_jobs").all()).toEqual([]);
			expect(sqlite.prepare("SELECT * FROM changes WHERE op = 'purged'").all()).toEqual([]);
			expect(sqlite.prepare("SELECT * FROM attachments").all()).toHaveLength(2);
			expect(sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(1);
			expect(files.delete).not.toHaveBeenCalled();
		},
	);

	it.each(["lookup", "prepare", "batch", "diagnostic", "mid-batch"])(
		"returns safe 503 for %s failure without external effects",
		async (failure) => {
			const { db, sqlite, memoryId, files } = await fixture();
			if (failure === "lookup")
				vi.spyOn(db, "prepare").mockImplementationOnce(() => {
					throw new Error("private lookup");
				});
			if (failure === "prepare") {
				const prepare = db.prepare.bind(db);
				vi.spyOn(db, "prepare")
					.mockImplementationOnce(prepare)
					.mockImplementationOnce(() => {
						throw new Error("private preparation");
					});
			}
			if (failure === "batch")
				vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("private commit"));
			if (failure === "diagnostic")
				vi.spyOn(db, "batch").mockImplementationOnce(async () => {
					vi.spyOn(db, "prepare").mockImplementationOnce(() => {
						throw new Error("private diagnostic");
					});
					throw new Error("private commit");
				});
			if (failure === "mid-batch")
				sqlite.exec(
					"CREATE TRIGGER fail_purge BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT, 'private failure'); END",
				);
			await expect(purgeMemory(db, memoryId, "admin:owner@local")).rejects.toMatchObject({
				status: 503,
				message: "purge transaction unavailable",
			});
			expect(sqlite.prepare("SELECT * FROM memories").all()).toHaveLength(1);
			expect(sqlite.prepare("SELECT * FROM attachments").all()).toHaveLength(2);
			expect(sqlite.prepare("SELECT * FROM external_file_cleanup_jobs").all()).toEqual([]);
			expect(sqlite.prepare("SELECT * FROM changes WHERE op = 'purged'").all()).toEqual([]);
			expect(files.delete).not.toHaveBeenCalled();
		},
	);

	it("retries failed R2 deletes and continues other jobs without logging object names or errors", async () => {
		const { db, sqlite, memoryId, files, env } = await fixture();
		await purgeMemory(db, memoryId, "admin:owner@local");
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		files.delete.mockRejectedValueOnce(new Error("private R2 failure"));
		await cleanupExternalFiles(env);
		expect(sqlite.prepare("SELECT r2_key FROM external_file_cleanup_jobs").all()).toEqual([
			{ r2_key: "files/a1" },
		]);
		expect(log.mock.calls).toEqual([["purge file cleanup failed"]]);
		await cleanupExternalFiles(env);
		expect(sqlite.prepare("SELECT * FROM external_file_cleanup_jobs").all()).toEqual([]);
	});

	it("does not let a failed first batch starve later purge cleanup", async () => {
		const { sqlite, files, env } = await fixture();
		for (let index = 0; index < 101; index++) {
			sqlite
				.prepare("INSERT INTO external_file_cleanup_jobs (r2_key, created_at) VALUES (?, 1)")
				.run(`purge-${String(index).padStart(3, "0")}`);
		}
		files.delete.mockImplementation(async (key) => {
			if (key !== "purge-100") throw new Error("provider failure");
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		await cleanupExternalFiles(env);
		await cleanupExternalFiles(env);
		expect(files.delete).toHaveBeenCalledWith("purge-100");
		expect(
			sqlite
				.prepare("SELECT r2_key FROM external_file_cleanup_jobs WHERE r2_key = 'purge-100'")
				.get(),
		).toBeUndefined();
	});

	it("orders interrupted attempts behind untouched file cleanup", async () => {
		const { sqlite, files, env } = await fixture();
		sqlite.exec(
			"INSERT INTO external_file_cleanup_jobs (r2_key, created_at) VALUES ('a-stuck', 1), ('z-healthy', 1)",
		);
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		files.delete.mockImplementationOnce(async () => {
			entered.resolve();
			await release.promise;
		});
		const abandoned = cleanupExternalFiles(env);
		await entered.promise;
		try {
			await cleanupExternalFiles(env);
			expect(files.delete.mock.calls.slice(0, 2)).toEqual([["a-stuck"], ["z-healthy"]]);
		} finally {
			release.resolve();
			await abandoned;
		}
	});

	it("retries an already deleted object when the D1 acknowledgment fails", async () => {
		const { db, sqlite, memoryId, files, env } = await fixture();
		await purgeMemory(db, memoryId, "admin:owner@local");
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const prepare = db.prepare.bind(db);
		let failed = false;
		vi.spyOn(db, "prepare").mockImplementation((sql) => {
			if (!failed && sql.startsWith("DELETE FROM external_file_cleanup_jobs")) {
				failed = true;
				throw new Error("private acknowledgment failure");
			}
			return prepare(sql);
		});
		await cleanupExternalFiles(env);
		expect(sqlite.prepare("SELECT r2_key FROM external_file_cleanup_jobs").all()).toEqual([
			{ r2_key: "files/a1" },
		]);
		await cleanupExternalFiles(env);
		expect(files.delete.mock.calls).toEqual([["files/a1"], ["files/a2"], ["files/a1"]]);
		expect(log).toHaveBeenCalledWith("purge file cleanup failed");
	});
});
