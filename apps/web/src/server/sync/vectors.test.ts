import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import { CloudflareVectorStore } from "../ports/vector/cloudflare";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { encodeFloat32Vector } from "../search/math";
import { RECONCILE_INTERVAL_MS, SYNC_LEASE_MS, synchronizeVectors } from "./vectors";

function fixture() {
	const { db, sqlite } = sqliteD1();
	sqlite.exec("UPDATE embedding_profiles SET dims = 2");
	sqlite.exec(`INSERT INTO memories (id,space_id,title,body,type,importance,source_key_id,version,content_hash,created_at,updated_at)
		VALUES ('memory','space:kb','title','body','note',0.5,'source',1,'hash',10,20)`);
	sqlite
		.prepare(`INSERT INTO memory_vectors (memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
		VALUES ('memory','te3-small-1536','text-embedding-3-small',2,?,'hash',20)`)
		.run(encodeFloat32Vector([1, 0]));
	const store = { upsert: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
	const env = { DB: db, RESOURCE_ENV: "test" } as Env;
	const indexed = () => sqlite.prepare("SELECT indexed_at FROM memory_vectors").get()?.indexed_at;
	return { db, sqlite, store, env, indexed };
}

describe("durable vector synchronization", () => {
	it("advances abandoned claims so expired leases cannot starve untouched jobs", async () => {
		const { env, store, sqlite } = fixture();
		sqlite.exec("INSERT INTO vector_sync_jobs (memory_id) VALUES ('z-healthy')");
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		store.upsert.mockImplementationOnce(async () => {
			entered.resolve();
			await release.promise;
		});
		const abandoned = synchronizeVectors(env, { store, now: 100, limit: 1 });
		await entered.promise;
		try {
			await synchronizeVectors(env, { store, now: 101 + SYNC_LEASE_MS, limit: 1 });
			expect(store.delete).toHaveBeenCalledWith(["z-healthy"]);
		} finally {
			release.resolve();
			await abandoned;
		}
	});

	it("moves failed tasks behind untouched work instead of starving purge", async () => {
		const { env, sqlite } = fixture();
		sqlite.exec("DELETE FROM vector_sync_jobs");
		for (let index = 0; index < 51; index++) {
			sqlite
				.prepare("INSERT INTO vector_sync_jobs (memory_id) VALUES (?)")
				.run(`job-${String(index).padStart(2, "0")}`);
		}
		const deleted: string[] = [];
		const store = {
			upsert: vi.fn(async () => {}),
			delete: vi.fn(async (ids: string[]) => {
				if (ids[0] !== "job-50") throw new Error("provider failure");
				deleted.push(...ids);
			}),
		};
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		await synchronizeVectors(env, { store, now: 100 });
		await synchronizeVectors(env, { store, now: 101 });
		expect(deleted).toEqual(["job-50"]);
		log.mockRestore();
	});

	it("upserts current metadata and acknowledges only after success", async () => {
		const { env, store, indexed, sqlite } = fixture();
		expect(indexed()).toBeNull();
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 1, failed: 0 });
		expect(store.upsert).toHaveBeenCalledWith([
			{
				id: "memory",
				values: [1, 0],
				metadata: {
					space: "kb",
					type: "note",
					source: "source",
					importance: 0.5,
					created: 10,
					updated: 20,
				},
			},
		]);
		expect(indexed()).toBe(100);
		await synchronizeVectors(env, { store, now: 101 });
		expect(store.upsert).toHaveBeenCalledTimes(1);
		sqlite.exec(
			"UPDATE memories SET type = 'fact', event_time = 30, importance = 0.8 WHERE id = 'memory'",
		);
		expect(indexed()).toBeNull();
		await synchronizeVectors(env, { store, now: 102 });
		expect(store.upsert.mock.lastCall).toEqual([
			[
				expect.objectContaining({
					metadata: expect.objectContaining({ type: "fact", event: 30, importance: 0.8 }),
				}),
			],
		]);
	});

	it("retries transient failures in the same drain without changing authoritative vectors", async () => {
		const { env, store, indexed } = fixture();
		store.upsert.mockRejectedValueOnce(new Error("private provider details"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 1, failed: 1 });
		expect(store.upsert).toHaveBeenCalledTimes(2);
		expect(indexed()).toBe(100);
		expect(log.mock.calls.flat().join(" ")).not.toContain("private provider");
		log.mockRestore();
	});

	it("bounds persistent failures and leaves the job available to a later drain", async () => {
		const { env, store, indexed, sqlite } = fixture();
		store.upsert.mockRejectedValue(new Error("provider failure"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 0, failed: 3 });
		expect(store.upsert).toHaveBeenCalledTimes(3);
		expect(indexed()).toBeNull();
		expect(
			sqlite.prepare("SELECT due_at, lease_until, lease_token FROM vector_sync_jobs").get(),
		).toEqual({ due_at: 100, lease_until: 0, lease_token: null });
		store.upsert.mockResolvedValue(undefined);
		expect(await synchronizeVectors(env, { store, now: 101 })).toEqual({ synced: 1, failed: 0 });
		expect(indexed()).toBe(101);
		log.mockRestore();
	});

	it.each([
		{ stage: "backfill", error: new TypeError("secret-token private body"), name: "TypeError" },
		{
			stage: "upsert",
			error: Object.assign(new Error("secret-token"), { name: "private body" }),
			name: "Error",
		},
		{ stage: "delete", error: { message: "secret-token private body" }, name: "UnknownError" },
	])(
		"logs safe structured $stage failures without provider details",
		async ({ stage, error, name }) => {
			const { env, store, sqlite } = fixture();
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			const fail = async () => {
				throw error;
			};
			if (stage === "delete") {
				sqlite.exec("UPDATE memories SET deleted_at = 50 WHERE id = 'memory'");
				store.delete.mockImplementation(fail);
			} else if (stage === "upsert") {
				store.upsert.mockImplementation(fail);
			}
			await synchronizeVectors(env, {
				store,
				now: 100,
				beforeSync: stage === "backfill" ? fail : async () => {},
			});
			expect(log).toHaveBeenCalledTimes(3);
			expect(log).toHaveBeenCalledWith({
				event: "vector_sync_failed",
				memory_id: "memory",
				name,
				message: `Vector synchronization failed during ${stage}`,
			});
			expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|private body/);
			log.mockRestore();
		},
	);

	it("deletes on trash, reindexes restore and keeps purge tombstones", async () => {
		const { env, store, sqlite, indexed } = fixture();
		sqlite.exec("UPDATE memories SET deleted_at = 50 WHERE id = 'memory'");
		await synchronizeVectors(env, { store, now: 100 });
		expect(store.delete).toHaveBeenCalledWith(["memory"]);
		expect(indexed()).toBeNull();
		sqlite.exec("UPDATE memories SET deleted_at = NULL WHERE id = 'memory'");
		await synchronizeVectors(env, { store, now: 101 });
		expect(indexed()).toBe(101);
		sqlite.exec("DELETE FROM memory_vectors; DELETE FROM memories");
		await synchronizeVectors(env, { store, now: 102 });
		expect(store.delete).toHaveBeenCalledTimes(2);
		await synchronizeVectors(env, { store, now: 103 + RECONCILE_INTERVAL_MS });
		expect(store.delete).toHaveBeenCalledTimes(3);
	});

	it.each([undefined, "1"])(
		"drains overlapping writes to the latest generation (mode %s)",
		async (mode) => {
			const { env, store, sqlite, indexed } = fixture();
			if (mode) env.OCTO_VECTOR_SYNC_PARALLEL = mode;
			store.upsert.mockImplementationOnce(async () => {
				sqlite.exec(
					"UPDATE memories SET space_id = 'space:dest', updated_at = 40 WHERE id = 'memory'",
				);
				sqlite
					.prepare("UPDATE memory_vectors SET vector = ? WHERE memory_id = 'memory'")
					.run(encodeFloat32Vector([0, 1]));
				expect(await synchronizeVectors(env, { store, now: 101 })).toEqual({
					synced: 0,
					failed: 0,
				});
				expect(indexed()).toBeNull();
			});
			expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 1, failed: 0 });
			expect(indexed()).toBe(100);
			expect(store.upsert).toHaveBeenCalledTimes(2);
			const job = sqlite.prepare("SELECT * FROM vector_sync_jobs").get();
			expect(job?.synced_generation).toBe(job?.generation);
			expect(store.upsert.mock.lastCall).toEqual([
				[
					expect.objectContaining({
						values: [0, 1],
						metadata: expect.objectContaining({ space: "dest", updated: 40 }),
					}),
				],
			]);
		},
	);

	it("bounds repeated generation changes without acknowledging stale writes", async () => {
		const { env, store, sqlite, indexed } = fixture();
		store.upsert.mockImplementation(async () => {
			sqlite.exec("UPDATE memories SET updated_at = updated_at + 1 WHERE id = 'memory'");
		});
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 0, failed: 0 });
		expect(store.upsert).toHaveBeenCalledTimes(3);
		expect(indexed()).toBeNull();
		const job = sqlite.prepare("SELECT * FROM vector_sync_jobs").get();
		expect(job?.synced_generation).not.toBe(job?.generation);
		expect(job).toMatchObject({ due_at: 100, lease_until: 0, lease_token: null });
		store.upsert.mockResolvedValue(undefined);
		expect(await synchronizeVectors(env, { store, now: 101 })).toEqual({ synced: 1, failed: 0 });
	});

	it("recovers abandoned leases and reconciles late stale completions", async () => {
		const { env, store, sqlite, indexed } = fixture();
		store.upsert.mockImplementationOnce(async () => {
			sqlite.exec("UPDATE memories SET importance = 0.1 WHERE id = 'memory'");
			await synchronizeVectors(env, { store, now: 101 + SYNC_LEASE_MS });
		});
		await synchronizeVectors(env, { store, now: 100 });
		expect(indexed()).toBe(100);
		expect(store.upsert).toHaveBeenCalledTimes(3);
		await synchronizeVectors(env, { store, now: 102 + SYNC_LEASE_MS });
		expect(indexed()).toBe(100);
	});

	it("leaves a newer live lease to its holder when a stale operation finishes", async () => {
		const { env, store, sqlite, indexed } = fixture();
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let newer: ReturnType<typeof synchronizeVectors> | undefined;
		store.upsert
			.mockImplementationOnce(async () => {
				sqlite.exec("UPDATE memories SET importance = 0.1 WHERE id = 'memory'");
				newer = synchronizeVectors(env, { store, now: 101 + SYNC_LEASE_MS });
				await entered.promise;
			})
			.mockImplementationOnce(async () => {
				entered.resolve();
				await release.promise;
			});
		try {
			expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 0, failed: 0 });
			expect(store.upsert).toHaveBeenCalledTimes(2);
			expect(indexed()).toBeNull();
			expect(sqlite.prepare("SELECT lease_token, lease_until FROM vector_sync_jobs").get()).toEqual(
				{
					lease_token: expect.any(String),
					lease_until: 101 + 2 * SYNC_LEASE_MS,
				},
			);
		} finally {
			release.resolve();
			await newer;
		}
		expect(store.upsert).toHaveBeenCalledTimes(3);
		expect(indexed()).toBe(101 + SYNC_LEASE_MS);
		const job = sqlite.prepare("SELECT * FROM vector_sync_jobs").get();
		expect(job?.synced_generation).toBe(job?.generation);
	});

	it("invalidates slug changes and vector removal, but rolls back failed writes", async () => {
		const { env, store, sqlite, indexed } = fixture();
		await synchronizeVectors(env, { store, now: 100 });
		sqlite.exec("BEGIN; UPDATE memories SET type = 'fact'; ROLLBACK");
		expect(indexed()).toBe(100);
		sqlite.exec("UPDATE spaces SET slug = 'renamed' WHERE id = 'space:kb'");
		expect(indexed()).toBeNull();
		await synchronizeVectors(env, { store, now: 101 });
		expect(store.upsert.mock.lastCall).toEqual([
			[expect.objectContaining({ metadata: expect.objectContaining({ space: "renamed" }) })],
		]);
		sqlite.exec("DELETE FROM memory_vectors");
		await synchronizeVectors(env, { store, now: 102 });
		expect(store.delete).toHaveBeenCalledWith(["memory"]);
	});

	it("uses local authoritative D1 and rejects missing production binding", async () => {
		const { env, indexed } = fixture();
		await synchronizeVectors(env, { now: 100 });
		expect(indexed()).toBe(100);
		await expect(
			synchronizeVectors(
				{ ...env, RESOURCE_ENV: "production" },
				{ now: 100 + RECONCILE_INTERVAL_MS },
			),
		).rejects.toThrow("VEC binding");
	});

	it("bounds work and handles an inactive profile safely", async () => {
		const { env, sqlite, store } = fixture();
		expect(await synchronizeVectors(env, { store, limit: 0, now: 100 })).toEqual({
			synced: 0,
			failed: 0,
		});
		sqlite.exec("UPDATE embedding_profiles SET active = 0");
		await expect(synchronizeVectors(env, { store, now: 100 })).rejects.toThrow(
			"active embedding profile",
		);
		expect(store.delete).not.toHaveBeenCalled();
	});

	it("skips a claim won by another runner after selection", async () => {
		const { env, db, store } = fixture();
		const prepare = db.prepare.bind(db);
		vi.spyOn(db, "prepare").mockImplementation((sql) => {
			if (sql.startsWith("UPDATE vector_sync_jobs SET lease_token")) {
				return { bind: () => ({ first: async () => null }) } as unknown as D1PreparedStatement;
			}
			return prepare(sql);
		});
		expect(await synchronizeVectors(env, { store })).toEqual({ synced: 0, failed: 0 });
		expect(store.upsert).not.toHaveBeenCalled();
	});

	it("runs default local reconciliation and invalidates replaced vectors", async () => {
		const { env, sqlite, indexed } = fixture();
		await synchronizeVectors(env);
		expect(indexed()).toEqual(expect.any(Number));
		sqlite
			.prepare("UPDATE memory_vectors SET vector = ?, updated_at = 300")
			.run(encodeFloat32Vector([0, 1]));
		expect(indexed()).toBeNull();
		await synchronizeVectors(env);
		expect(indexed()).toEqual(expect.any(Number));
	});
});

describe("VectorStore write port", () => {
	it("maps Cloudflare writes and propagates rejected mutations", async () => {
		const upsert = vi.fn(async () => ({ mutationId: "one" }));
		const deleteByIds = vi.fn(async () => ({ mutationId: "two" }));
		const store = new CloudflareVectorStore({ upsert, deleteByIds } as never);
		const records = [{ id: "memory", values: [1, 0], metadata: { space: "kb" } }];
		await store.upsert(records);
		await store.delete(["memory"]);
		expect(upsert).toHaveBeenCalledWith(records);
		expect(deleteByIds).toHaveBeenCalledWith(["memory"]);
		upsert.mockRejectedValueOnce(new Error("failed"));
		await expect(store.upsert(records)).rejects.toThrow("failed");
	});

	it("does not erase the source vector when deleting from the local derived port", async () => {
		const { db, sqlite } = fixture();
		const store = new D1BruteForceVectorStore(db, "te3-small-1536", {
			clauses: ["m.deleted_at IS NULL"],
			binds: [],
		});
		await store.upsert([{ id: "memory", values: [0, 1], metadata: {} }]);
		await store.delete(["memory"]);
		expect(sqlite.prepare("SELECT count(*) AS count FROM memory_vectors").get()?.count).toBe(1);
		expect(await store.query({ vector: [1, 0], topK: 10, returnMetadata: false })).toEqual([
			{ id: "memory", score: 1 },
		]);
	});
});
