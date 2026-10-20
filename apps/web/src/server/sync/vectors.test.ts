import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import { CloudflareVectorStore } from "../ports/vector/cloudflare";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import { encodeFloat32Vector } from "../search/math";
import { FAILURE_BACKOFF_MS, SYNC_LEASE_MS, synchronizeVectors } from "./vectors";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

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

function addVectors(sqlite: ReturnType<typeof fixture>["sqlite"], count: number) {
	for (let index = 1; index < count; index++) {
		const id = `memory-${String(index).padStart(3, "0")}`;
		sqlite
			.prepare(`INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
			SELECT ?,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at FROM memories WHERE id = 'memory'`)
			.run(id);
		sqlite
			.prepare(`INSERT INTO memory_vectors (memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
			SELECT ?,profile_id,embedding_model,dim,vector,content_hash,updated_at FROM memory_vectors WHERE memory_id = 'memory'`)
			.run(id);
	}
}

describe("durable vector synchronization", () => {
	it.each([false, true])(
		"batches ready vectors into 100-record calls with backfill=%s",
		async (backfill) => {
			const { env, sqlite } = fixture();
			addVectors(sqlite, 205);
			const upsert = vi.fn(async (_records: VectorizeVector[]) => {});
			const beforeSyncBatch = vi.fn(async () => {});
			expect(
				await synchronizeVectors(env, {
					store: { upsert, delete: vi.fn() },
					now: 100,
					limit: 205,
					...(backfill ? { beforeSyncBatch } : {}),
				}),
			).toEqual({ synced: 205, failed: 0 });
			expect(upsert.mock.calls.map(([records]) => records.length)).toEqual([100, 100, 5]);
			expect(beforeSyncBatch).not.toHaveBeenCalled();
		},
	);

	it("charges only the rejected upsert chunk and leaves successful chunks acknowledged", async () => {
		const { env, sqlite } = fixture();
		addVectors(sqlite, 205);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const upsert = vi.fn(async (records: VectorizeVector[]) => {
			if (records.some((record) => record.id === "memory-100"))
				throw new Error("service unavailable");
		});
		expect(
			await synchronizeVectors(env, { store: { upsert, delete: vi.fn() }, now: 100, limit: 205 }),
		).toEqual({ synced: 105, failed: 100 });
		expect(
			sqlite.prepare("SELECT COUNT(*) AS count FROM vector_sync_jobs WHERE attempts = 1").get()
				?.count,
		).toBe(100);
		expect(upsert).toHaveBeenCalledTimes(3);
	});

	it("rereads an upsert superseded while other records are prepared", async () => {
		const { env, sqlite } = fixture();
		addVectors(sqlite, 2);
		env.OCTO_VECTOR_SYNC_CONCURRENCY = "1";
		const upsert = vi.fn(async (_records: VectorizeVector[]) => {});
		expect(
			await synchronizeVectors(env, {
				store: { upsert, delete: vi.fn() },
				now: 100,
				beforeSync: async (id) => {
					if (id === "memory-001")
						sqlite.exec("UPDATE memories SET importance = 0.8 WHERE id = 'memory'");
				},
			}),
		).toEqual({ synced: 2, failed: 0 });
		expect(
			upsert.mock.calls.flatMap(([records]) => records).filter((record) => record.id === "memory"),
		).toEqual([
			expect.objectContaining({ metadata: expect.objectContaining({ importance: 0.8 }) }),
		]);
	});

	it("releases every rate-limited batch member without penalizing other chunks", async () => {
		const { env, sqlite } = fixture();
		addVectors(sqlite, 205);
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const upsert = vi.fn(async (records: VectorizeVector[]) => {
			if (records.some((record) => record.id === "memory-100")) throw { code: 40041 };
		});
		const work = synchronizeVectors(env, {
			store: { upsert, delete: vi.fn() },
			now: 100,
			limit: 205,
		});
		await vi.runAllTimersAsync();
		expect(await work).toEqual({ synced: 105, failed: 100 });
		expect(upsert.mock.calls.map(([records]) => records.length)).toEqual([100, 100, 100, 100, 5]);
		expect(
			sqlite
				.prepare(
					"SELECT count(*) AS count FROM vector_sync_jobs WHERE attempts = 0 AND dead_at IS NULL AND due_at = 90100 AND lease_token IS NULL",
				)
				.get()?.count,
		).toBe(100);
	});

	it("requeues only the unacknowledged member of a successful upsert batch", async () => {
		const { env, db, sqlite } = fixture();
		addVectors(sqlite, 2);
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("private SQL"));
		const upsert = vi.fn(async (_records: VectorizeVector[]) => {});
		expect(await synchronizeVectors(env, { store: { upsert, delete: vi.fn() }, now: 100 })).toEqual(
			{ synced: 1, failed: 1 },
		);
		expect(upsert).toHaveBeenCalledTimes(1);
		expect(
			sqlite.prepare("SELECT count(*) AS count FROM vector_sync_jobs WHERE attempts = 1").get()
				?.count,
		).toBe(1);
		expect(
			sqlite
				.prepare(
					"SELECT count(*) AS count FROM vector_sync_jobs WHERE generation = synced_generation",
				)
				.get()?.count,
		).toBe(1);
	});

	it("revalidates a batch after rate-limit sleep before retrying the provider", async () => {
		const { env, sqlite } = fixture();
		addVectors(sqlite, 2);
		vi.useFakeTimers();
		const upsert = vi.fn(async (_records: VectorizeVector[]) => {});
		upsert.mockImplementationOnce(async () => {
			sqlite.exec("UPDATE memories SET importance = 0.8 WHERE id = 'memory'");
			throw { status: 429 };
		});
		const work = synchronizeVectors(env, { store: { upsert, delete: vi.fn() }, now: 100 });
		await vi.runAllTimersAsync();
		expect(await work).toEqual({ synced: 2, failed: 0 });
		expect(upsert.mock.calls.map(([records]) => records.map((record) => record.id))).toEqual([
			["memory", "memory-001"],
			["memory-001"],
			["memory"],
		]);
	});

	it("does not rewrite unchanged vectors even when legacy jobs become due", async () => {
		const { env, sqlite, store, indexed } = fixture();
		await synchronizeVectors(env, { store, now: 100 });
		sqlite.exec("UPDATE vector_sync_jobs SET due_at = 3600100");
		expect(await synchronizeVectors(env, { store, now: 3600100 })).toEqual({
			synced: 0,
			failed: 0,
		});
		expect(await synchronizeVectors(env, { store, now: 86400100 })).toEqual({
			synced: 0,
			failed: 0,
		});
		expect(store.upsert).toHaveBeenCalledTimes(1);
		expect(indexed()).toBe(100);
	});

	it.each([
		"UPDATE memories SET importance = 0.8",
		"UPDATE memories SET deleted_at = 50; UPDATE memories SET deleted_at = NULL",
		"UPDATE memories SET space_id = 'space:dest'",
		"UPDATE spaces SET slug = 'renamed' WHERE id = 'space:kb'",
		"UPDATE memory_vectors SET updated_at = 30",
	])("reschedules acknowledged work on authoritative mutation: %s", async (mutation) => {
		const { env, sqlite, store, indexed } = fixture();
		await synchronizeVectors(env, { store, now: 100 });
		sqlite.exec(mutation);
		expect(indexed()).toBeNull();
		expect(await synchronizeVectors(env, { store, now: 101 })).toEqual({ synced: 1, failed: 0 });
		expect(store.upsert).toHaveBeenCalledTimes(2);
		if (mutation.includes("space_id"))
			expect(store.upsert).toHaveBeenLastCalledWith([
				expect.objectContaining({ metadata: expect.objectContaining({ space: "dest" }) }),
			]);
	});

	it.each([
		"UPDATE embedding_profiles SET model = 'changed' WHERE active = 1",
		"UPDATE embedding_profiles SET dims = 3 WHERE active = 1",
		"UPDATE embedding_profiles SET vectorize_index = 'rebuilt' WHERE active = 1",
		"UPDATE embedding_profiles SET active = 0; INSERT INTO embedding_profiles VALUES ('next','next',2,'cosine','next',1,1)",
	])("invalidates completed vectors on profile change: %s", async (mutation) => {
		const { env, sqlite, store, indexed } = fixture();
		await synchronizeVectors(env, { store, now: 100 });
		sqlite.exec(mutation);
		expect(indexed()).toBeNull();
		expect(
			sqlite
				.prepare(
					"SELECT generation IS NOT synced_generation AS pending, due_at FROM vector_sync_jobs",
				)
				.get(),
		).toEqual({ pending: 1, due_at: 0 });
		expect(await synchronizeVectors(env, { store, now: 101 })).toEqual({ synced: 1, failed: 0 });
	});

	it("leaves a profile switch pending rather than acknowledging the old index", async () => {
		const { env, sqlite, store, indexed } = fixture();
		store.upsert.mockImplementationOnce(async () => {
			sqlite.exec(
				"UPDATE embedding_profiles SET active = 0; INSERT INTO embedding_profiles VALUES ('next','next',2,'cosine','next',1,1)",
			);
		});
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 0, failed: 0 });
		expect(indexed()).toBeNull();
		expect(
			sqlite
				.prepare("SELECT generation IS NOT synced_generation AS pending FROM vector_sync_jobs")
				.get()?.pending,
		).toBe(1);
		sqlite
			.prepare(`INSERT INTO memory_vectors (memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
			VALUES ('memory','next','next',2,?,'hash',101)`)
			.run(encodeFloat32Vector([0, 1]));
		expect(await synchronizeVectors(env, { store, now: 101 })).toEqual({ synced: 1, failed: 0 });
		expect(
			sqlite.prepare("SELECT indexed_at FROM memory_vectors WHERE profile_id = 'next'").get()
				?.indexed_at,
		).toBe(101);
	});

	it.each(["upsert", "delete"] as const)(
		"briefly retries a rate-limited %s before acknowledging",
		async (operation) => {
			const { env, sqlite, store } = fixture();
			vi.useFakeTimers();
			vi.spyOn(Math, "random").mockReturnValue(0.5);
			if (operation === "delete") sqlite.exec("UPDATE memories SET deleted_at = 50");
			store[operation]
				.mockRejectedValueOnce({ code: 40041 })
				.mockRejectedValueOnce({ status: 429 });
			const started = Date.now();
			const work = synchronizeVectors(env, { store, now: 100 });
			await vi.runAllTimersAsync();
			expect(await work).toEqual({ synced: 1, failed: 0 });
			expect(Date.now() - started).toBe(450);
			expect(store[operation]).toHaveBeenCalledTimes(3);
			expect(sqlite.prepare("SELECT attempts, dead_at FROM vector_sync_jobs").get()).toEqual({
				attempts: 0,
				dead_at: null,
			});
		},
	);

	it.each(["upsert", "delete"] as const)(
		"releases an exhausted %s rate limit without charging failures",
		async (operation) => {
			const { env, sqlite, store } = fixture();
			vi.useFakeTimers();
			vi.spyOn(Math, "random").mockReturnValue(0.5);
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			if (operation === "delete") sqlite.exec("UPDATE memories SET deleted_at = 50");
			sqlite.exec("UPDATE vector_sync_jobs SET attempts = 7");
			store[operation].mockRejectedValue(new Error("Too Many Requests: private body"));
			const work = synchronizeVectors(env, { store, now: 100 });
			await vi.runAllTimersAsync();
			expect(await work).toEqual({ synced: 0, failed: 1 });
			expect(store[operation]).toHaveBeenCalledTimes(3);
			expect(
				sqlite
					.prepare(
						"SELECT attempts, due_at, dead_at, lease_token, lease_until FROM vector_sync_jobs",
					)
					.get(),
			).toEqual({
				attempts: 7,
				due_at: 90_100,
				dead_at: null,
				lease_token: null,
				lease_until: 0,
			});
			expect(log).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ event: "vector_sync_rate_limited" }),
			);
			expect(JSON.stringify(log.mock.calls)).not.toContain("private body");
			expect(await synchronizeVectors(env, { store, now: 90_099 })).toEqual({
				synced: 0,
				failed: 0,
			});
			store[operation].mockResolvedValue(undefined);
			expect(await synchronizeVectors(env, { store, now: 90_100 })).toEqual({
				synced: 1,
				failed: 0,
			});
		},
	);

	it("prioritizes the committed memory independently of a full backlog", async () => {
		const { env, sqlite, store, indexed } = fixture();
		for (let index = 0; index < 60; index++) {
			sqlite.prepare("INSERT INTO vector_sync_jobs (memory_id) VALUES (?)").run(`backlog-${index}`);
		}
		expect(await synchronizeVectors(env, { store, now: 100, memoryIds: ["memory"] })).toEqual({
			synced: 1,
			failed: 0,
		});
		expect(indexed()).toBe(100);
		expect(store.delete).not.toHaveBeenCalled();
		expect(store.upsert).toHaveBeenCalledTimes(1);
		expect(store.upsert).toHaveBeenCalledWith([
			expect.objectContaining({
				id: "memory",
				metadata: expect.objectContaining({ generation: 2, content_hash: "hash" }),
			}),
		]);
	});

	it("does not upsert a stale body vector and deletes its deterministic ID immediately", async () => {
		const { env, sqlite, store, indexed } = fixture();
		sqlite.exec("UPDATE memories SET content_hash = 'changed', version = 2");
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 1, failed: 0 });
		expect(store.upsert).not.toHaveBeenCalled();
		expect(store.delete).toHaveBeenCalledWith(["memory"]);
		expect(indexed()).toBeNull();
	});

	it("marks accepted vectors visible only after a matching query generation and content hash", async () => {
		const { env, sqlite, store, indexed } = fixture();
		const query = vi.fn(async () => [
			{ id: "memory", score: 1, generation: 1, content_hash: "hash" },
		]);
		await synchronizeVectors(env, { store: { ...store, query }, now: 100 });
		expect(indexed()).toBe(100);
		expect(
			sqlite.prepare("SELECT visible_generation FROM vector_sync_jobs").get()?.visible_generation,
		).toBeNull();
		query.mockResolvedValue([{ id: "memory", score: 1, generation: 2, content_hash: "hash" }]);
		await synchronizeVectors(env, { store: { ...store, query }, now: 101 });
		expect(
			sqlite.prepare("SELECT visible_generation FROM vector_sync_jobs").get()?.visible_generation,
		).toBe(2);
		expect(store.upsert).toHaveBeenCalledTimes(1);
	});

	it("respects backoff even when a write targets a failed generation", async () => {
		const { env, sqlite, store } = fixture();
		sqlite.exec("UPDATE vector_sync_jobs SET attempts = 1, due_at = 1000");
		expect(await synchronizeVectors(env, { store, now: 100, memoryIds: ["memory"] })).toEqual({
			synced: 0,
			failed: 0,
		});
		expect(store.upsert).not.toHaveBeenCalled();
	});

	it("fails all claimed batch members when embedding preparation rejects", async () => {
		const { env, sqlite, store } = fixture();
		sqlite.exec(`UPDATE memories SET content_hash = 'changed';
			INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
			VALUES ('other','space:kb','other','body','note','source','hash',1,1)`);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const beforeSyncBatch = vi.fn(async () => {
			throw new Error("gateway failed");
		});
		expect(await synchronizeVectors(env, { store, now: 100, beforeSyncBatch })).toEqual({
			synced: 0,
			failed: 2,
		});
		expect(beforeSyncBatch).toHaveBeenCalledWith(["memory", "other"]);
		expect(store.upsert).not.toHaveBeenCalled();
		expect(
			sqlite
				.prepare(
					"SELECT count(*) AS count FROM vector_sync_jobs WHERE attempts = 1 AND lease_token IS NULL",
				)
				.get()?.count,
		).toBe(2);
		log.mockRestore();
	});

	it("starts queued work with a fresh lease and backs off from the failure time", async () => {
		const { env, store, sqlite } = fixture();
		const clock = vi.spyOn(Date, "now").mockReturnValue(100);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		env.OCTO_VECTOR_SYNC_CONCURRENCY = "1";
		sqlite.exec("INSERT INTO vector_sync_jobs (memory_id) VALUES ('z-missing')");
		store.upsert.mockImplementationOnce(async () => {
			clock.mockReturnValue(100 + 2 * SYNC_LEASE_MS);
		});
		store.delete.mockImplementationOnce(async () => {
			expect(
				sqlite
					.prepare("SELECT lease_until FROM vector_sync_jobs WHERE memory_id = 'z-missing'")
					.get()?.lease_until,
			).toBe(Date.now() + SYNC_LEASE_MS);
			clock.mockReturnValue(100 + 3 * SYNC_LEASE_MS);
			throw new Error("service unavailable");
		});
		expect(await synchronizeVectors(env, { store })).toEqual({ synced: 1, failed: 1 });
		expect(
			sqlite.prepare("SELECT due_at FROM vector_sync_jobs WHERE memory_id = 'z-missing'").get()
				?.due_at,
		).toBe(Date.now() + 2 * FAILURE_BACKOFF_MS);
		clock.mockRestore();
		log.mockRestore();
	});

	it("keeps the fifth job exclusively leased after four slow concurrent preparations", async () => {
		const { env, store, sqlite } = fixture();
		const clock = vi.spyOn(Date, "now").mockReturnValue(100);
		sqlite.exec("DELETE FROM vector_sync_jobs");
		for (let index = 0; index < 5; index++)
			sqlite.prepare("INSERT INTO vector_sync_jobs (memory_id) VALUES (?)").run(`job-${index}`);
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let calls = 0;
		const first = synchronizeVectors(env, {
			store,
			beforeSync: async (memoryId) => {
				calls++;
				if (calls <= 4) {
					if (calls === 4) entered.resolve();
					await release.promise;
				} else {
					expect(
						sqlite
							.prepare("SELECT lease_until FROM vector_sync_jobs WHERE memory_id = ?")
							.get(memoryId)?.lease_until,
					).toBe(Date.now() + SYNC_LEASE_MS);
					expect(await synchronizeVectors(env, { store })).toEqual({ synced: 0, failed: 0 });
				}
			},
		});
		await entered.promise;
		clock.mockReturnValue(101 + SYNC_LEASE_MS);
		release.resolve();
		expect(await first).toEqual({ synced: 5, failed: 0 });
		expect(store.delete).toHaveBeenCalledTimes(1);
	});

	it("rereads a restored generation queued before a batched delete", async () => {
		const { env, store, sqlite, indexed } = fixture();
		env.OCTO_VECTOR_SYNC_CONCURRENCY = "1";
		sqlite.exec(
			"UPDATE memories SET deleted_at = 50; INSERT INTO vector_sync_jobs (memory_id) VALUES ('z-missing')",
		);
		expect(
			await synchronizeVectors(env, {
				store,
				now: 100,
				beforeSync: async (memoryId) => {
					if (memoryId === "z-missing") sqlite.exec("UPDATE memories SET deleted_at = NULL");
				},
			}),
		).toEqual({ synced: 2, failed: 0 });
		expect(store.delete).toHaveBeenCalledExactlyOnceWith(["z-missing"]);
		expect(indexed()).toBe(100);
	});

	it.each([0, 7])(
		"does not discard the current owner's failure after a stale completion (prior failures %i)",
		async (prior) => {
			const { env, store, sqlite } = fixture();
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			sqlite.prepare("UPDATE vector_sync_jobs SET attempts = ?").run(prior);
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			let newer: ReturnType<typeof synchronizeVectors> | undefined;
			store.upsert
				.mockImplementationOnce(async () => {
					newer = synchronizeVectors(env, { store, now: 101 + SYNC_LEASE_MS });
					await entered.promise;
				})
				.mockImplementationOnce(async () => {
					entered.resolve();
					await release.promise;
					throw new Error("service unavailable");
				});
			try {
				expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({
					synced: 0,
					failed: 0,
				});
			} finally {
				release.resolve();
			}
			expect(await newer).toEqual({ synced: 0, failed: 1 });
			expect(
				sqlite.prepare("SELECT attempts, due_at, dead_at FROM vector_sync_jobs").get(),
			).toEqual({
				attempts: prior + 1,
				due_at: 101 + SYNC_LEASE_MS + Math.min(2 ** (prior + 1), 24) * FAILURE_BACKOFF_MS,
				dead_at: prior === 7 ? 101 + SYNC_LEASE_MS : null,
			});
			expect(log.mock.calls.filter(([entry]) => entry.event === "vector_sync_dead")).toHaveLength(
				prior === 7 ? 1 : 0,
			);
			expect(await synchronizeVectors(env, { store, now: 102 + SYNC_LEASE_MS })).toEqual({
				synced: 0,
				failed: 0,
			});
			log.mockRestore();
		},
	);

	it("rechecks queued deletion leases before sending the batch", async () => {
		const { env, store, sqlite } = fixture();
		const clock = vi.spyOn(Date, "now").mockReturnValue(100);
		env.OCTO_VECTOR_SYNC_CONCURRENCY = "1";
		sqlite.exec(
			"UPDATE memories SET deleted_at = 50; INSERT INTO vector_sync_jobs (memory_id) VALUES ('z-missing')",
		);
		expect(
			await synchronizeVectors(env, {
				store,
				beforeSync: async (memoryId) => {
					if (memoryId === "z-missing") {
						clock.mockReturnValue(101 + SYNC_LEASE_MS);
						expect(await synchronizeVectors(env, { store, limit: 1 })).toEqual({
							synced: 1,
							failed: 0,
						});
					}
				},
			}),
		).toEqual({ synced: 1, failed: 0 });
		expect(store.delete.mock.calls).toEqual([[["memory"]], [["z-missing"]]]);
	});

	it("does not charge a failed stale generation to a concurrent mutation", async () => {
		const { env, store, sqlite } = fixture();
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		store.upsert.mockImplementationOnce(async () => {
			sqlite.exec("UPDATE memories SET importance = 0.1 WHERE id = 'memory'");
			throw new Error("service unavailable");
		});
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 1, failed: 1 });
		expect(
			sqlite.prepare("SELECT attempts, last_error, dead_at FROM vector_sync_jobs").get(),
		).toEqual({ attempts: 0, last_error: null, dead_at: null });
		expect(await synchronizeVectors(env, { store, now: 101 })).toEqual({ synced: 0, failed: 0 });
		expect(store.upsert).toHaveBeenCalledTimes(2);
		log.mockRestore();
	});

	it.each([0, 7])(
		"preserves a newer owner's backoff or dead state after a late success (prior failures %i)",
		async (prior) => {
			const { env, store, sqlite, indexed } = fixture();
			const log = vi.spyOn(console, "error").mockImplementation(() => {});
			store.upsert
				.mockImplementationOnce(async () => {
					sqlite.prepare("UPDATE vector_sync_jobs SET attempts = ?").run(prior);
					expect(await synchronizeVectors(env, { store, now: 101 + SYNC_LEASE_MS })).toEqual({
						synced: 0,
						failed: 1,
					});
				})
				.mockRejectedValueOnce(new Error("service unavailable"));
			expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 0, failed: 0 });
			expect(store.upsert).toHaveBeenCalledTimes(2);
			expect(indexed()).toBeNull();
			expect(
				sqlite.prepare("SELECT attempts, last_error, due_at, dead_at FROM vector_sync_jobs").get(),
			).toEqual({
				attempts: prior + 1,
				last_error: "service unavailable",
				due_at: 101 + SYNC_LEASE_MS + Math.min(2 ** (prior + 1), 24) * FAILURE_BACKOFF_MS,
				dead_at: prior === 7 ? 101 + SYNC_LEASE_MS : null,
			});
			expect(await synchronizeVectors(env, { store, now: 102 + SYNC_LEASE_MS })).toEqual({
				synced: 0,
				failed: 0,
			});
			log.mockRestore();
		},
	);

	it("repairs a concurrent restore without repeating other successful batched deletions", async () => {
		const { env, store, sqlite, indexed } = fixture();
		sqlite.exec(
			"UPDATE memories SET deleted_at = 50; INSERT INTO vector_sync_jobs (memory_id) VALUES ('z-missing')",
		);
		store.delete.mockImplementationOnce(async () => {
			sqlite.exec("UPDATE memories SET deleted_at = NULL");
		});
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 2, failed: 0 });
		expect(store.delete).toHaveBeenCalledExactlyOnceWith(["memory", "z-missing"]);
		expect(store.upsert).toHaveBeenCalledTimes(1);
		expect(indexed()).toBe(100);
	});

	it("requeues only an unacknowledged row after a successful batch deletion", async () => {
		const { env, db, store, sqlite } = fixture();
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		sqlite.exec(
			"UPDATE memories SET deleted_at = 50; INSERT INTO vector_sync_jobs (memory_id) VALUES ('z-missing')",
		);
		vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("private SQL body"));
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 1, failed: 1 });
		expect(store.delete).toHaveBeenCalledExactlyOnceWith(["memory", "z-missing"]);
		expect(
			sqlite
				.prepare("SELECT attempts, last_error FROM vector_sync_jobs WHERE memory_id = 'memory'")
				.get(),
		).toEqual({ attempts: 1, last_error: "[redacted]" });
		expect(
			sqlite
				.prepare(
					"SELECT attempts, synced_generation = generation AS synced FROM vector_sync_jobs WHERE memory_id = 'z-missing'",
				)
				.get(),
		).toEqual({ attempts: 0, synced: 1 });
		expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL body");
		log.mockRestore();
	});

	it.each([
		"UPDATE memories SET importance = 0.8",
		"DELETE FROM memory_vectors; DELETE FROM memories",
		"UPDATE memory_vectors SET updated_at = 30",
		"DELETE FROM memory_vectors",
		"UPDATE spaces SET slug = 'new' WHERE id = 'space:kb'",
	])("revives dead work for authoritative changes: %s", (mutation) => {
		const { sqlite } = fixture();
		sqlite.exec(
			"UPDATE vector_sync_jobs SET attempts = 8, last_error = 'service unavailable', dead_at = 100",
		);
		sqlite.exec(mutation);
		expect(
			sqlite.prepare("SELECT attempts, last_error, dead_at, due_at FROM vector_sync_jobs").get(),
		).toEqual({ attempts: 0, last_error: null, dead_at: null, due_at: 0 });
	});

	it("backs off deletions exponentially, parks them after eight failures and revives on restore", async () => {
		const { env, store, sqlite } = fixture();
		sqlite.exec("UPDATE memories SET deleted_at = 50 WHERE id = 'memory'");
		store.delete.mockRejectedValue(new Error("service unavailable: private body"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		let now = 100;
		for (let attempts = 1; attempts <= 8; attempts++) {
			expect(await synchronizeVectors(env, { store, now })).toEqual({ synced: 0, failed: 1 });
			const due = now + Math.min(2 ** attempts, 24) * FAILURE_BACKOFF_MS;
			expect(
				sqlite.prepare("SELECT attempts, due_at, dead_at, last_error FROM vector_sync_jobs").get(),
			).toEqual({
				attempts,
				due_at: due,
				dead_at: attempts === 8 ? now : null,
				last_error: "service unavailable [redacted]",
			});
			expect(await synchronizeVectors(env, { store, now: due - 1 })).toEqual({
				synced: 0,
				failed: 0,
			});
			now = due;
		}
		expect(await synchronizeVectors(env, { store, now })).toEqual({ synced: 0, failed: 0 });
		expect(store.delete).toHaveBeenCalledTimes(8);
		expect(log.mock.calls.filter(([entry]) => entry.event === "vector_sync_dead")).toHaveLength(1);
		expect(JSON.stringify(log.mock.calls)).not.toContain("private body");
		sqlite.exec("UPDATE memories SET deleted_at = NULL WHERE id = 'memory'");
		expect(
			sqlite.prepare("SELECT attempts, last_error, dead_at, due_at FROM vector_sync_jobs").get(),
		).toEqual({ attempts: 0, last_error: null, dead_at: null, due_at: 0 });
		expect(await synchronizeVectors(env, { store, now })).toEqual({ synced: 1, failed: 0 });
		log.mockRestore();
	});

	it("batches deletes into at most 100 IDs and retries only a failed chunk", async () => {
		const { env, sqlite } = fixture();
		sqlite.exec("DELETE FROM vector_sync_jobs");
		for (let index = 0; index < 205; index++) {
			sqlite
				.prepare("INSERT INTO vector_sync_jobs (memory_id) VALUES (?)")
				.run(`deleted-${String(index).padStart(3, "0")}`);
		}
		const deleteByIds = vi.fn(async (ids: string[]) => {
			if (ids.includes("deleted-100")) throw new Error("service unavailable");
			return { mutationId: "done" };
		});
		const store = new CloudflareVectorStore({ deleteByIds } as never);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await synchronizeVectors(env, { store, now: 100, limit: 205 })).toEqual({
			synced: 105,
			failed: 100,
		});
		expect(deleteByIds.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 5]);
		expect(
			sqlite.prepare("SELECT COUNT(*) AS count FROM vector_sync_jobs WHERE attempts = 1").get()
				?.count,
		).toBe(100);
		deleteByIds.mockResolvedValue({ mutationId: "recovered" });
		sqlite.exec("UPDATE vector_sync_jobs SET due_at = 999999999 WHERE attempts = 0");
		expect(
			await synchronizeVectors(env, { store, now: 100 + 2 * FAILURE_BACKOFF_MS, limit: 205 }),
		).toEqual({ synced: 100, failed: 0 });
		expect(deleteByIds.mock.lastCall?.[0]).toEqual(
			Array.from({ length: 100 }, (_, index) => `deleted-${100 + index}`),
		);
		log.mockRestore();
	});

	it.each([undefined, "1", "2", "999", "invalid", "0", "1.5"])(
		"bounds active work with concurrency %s",
		async (setting) => {
			const { env, sqlite, store } = fixture();
			if (setting !== undefined) env.OCTO_VECTOR_SYNC_CONCURRENCY = setting;
			for (let index = 0; index < 12; index++)
				sqlite
					.prepare("INSERT INTO vector_sync_jobs (memory_id) VALUES (?)")
					.run(`missing-${index}`);
			let active = 0;
			let maximum = 0;
			await synchronizeVectors(env, {
				store,
				now: 100,
				beforeSync: async () => {
					active++;
					maximum = Math.max(maximum, active);
					await new Promise((resolve) => setTimeout(resolve, 1));
					active--;
				},
			});
			expect(maximum).toBe(setting === "1" ? 1 : setting === "2" ? 2 : 4);
		},
	);

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
					generation: 2,
					content_hash: "hash",
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

	it("defers transient failures without changing authoritative vectors", async () => {
		const { env, store, indexed, sqlite } = fixture();
		store.upsert.mockRejectedValueOnce(new Error("private provider details"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 0, failed: 1 });
		expect(store.upsert).toHaveBeenCalledTimes(1);
		expect(indexed()).toBeNull();
		expect(
			sqlite.prepare("SELECT attempts, last_error, due_at FROM vector_sync_jobs").get(),
		).toEqual({
			attempts: 1,
			last_error: "[redacted]",
			due_at: 100 + 2 * FAILURE_BACKOFF_MS,
		});
		expect(await synchronizeVectors(env, { store, now: 101 })).toEqual({ synced: 0, failed: 0 });
		expect(await synchronizeVectors(env, { store, now: 100 + 2 * FAILURE_BACKOFF_MS })).toEqual({
			synced: 1,
			failed: 0,
		});
		expect(sqlite.prepare("SELECT attempts, last_error FROM vector_sync_jobs").get()).toEqual({
			attempts: 0,
			last_error: null,
		});
		expect(log.mock.calls.flat().join(" ")).not.toContain("private provider");
		log.mockRestore();
	});

	it("bounds persistent failures and leaves the job available to a later drain", async () => {
		const { env, store, indexed, sqlite } = fixture();
		store.upsert.mockRejectedValue(new Error("provider failure"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await synchronizeVectors(env, { store, now: 100 })).toEqual({ synced: 0, failed: 1 });
		expect(store.upsert).toHaveBeenCalledTimes(1);
		expect(indexed()).toBeNull();
		expect(
			sqlite.prepare("SELECT due_at, lease_until, lease_token FROM vector_sync_jobs").get(),
		).toEqual({ due_at: 100 + 2 * FAILURE_BACKOFF_MS, lease_until: 0, lease_token: null });
		store.upsert.mockResolvedValue(undefined);
		expect(await synchronizeVectors(env, { store, now: 100 + 2 * FAILURE_BACKOFF_MS })).toEqual({
			synced: 1,
			failed: 0,
		});
		expect(indexed()).toBe(100 + 2 * FAILURE_BACKOFF_MS);
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
			expect(log).toHaveBeenCalledTimes(1);
			expect(log).toHaveBeenCalledWith({
				event: "vector_sync_failed",
				memory_id: "memory",
				name,
				message: `Vector synchronization failed during ${stage}`,
				error_message: "[redacted]",
				code: null,
			});
			expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|private body/);
			log.mockRestore();
		},
	);

	it("retains safe Vectorize diagnostics without logging credentials or bodies", async () => {
		const { env, store, sqlite } = fixture();
		sqlite.exec("UPDATE memories SET deleted_at = 50 WHERE id = 'memory'");
		store.delete.mockRejectedValue(
			Object.assign(
				new Error(
					`VECTOR_DELETE_ERROR (code = 10000): internal server error; Bearer secret-token; body: ${"private body".repeat(100)}`,
				),
				{ code: 10000 },
			),
		);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		await synchronizeVectors(env, { store, now: 100 });
		expect(log).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Error",
				code: 10000,
				error_message: "VECTOR_DELETE_ERROR (code = 10000): internal server error [redacted]",
			}),
		);
		expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|private body/);
		log.mockRestore();
	});

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
		await synchronizeVectors(env, { store, now: 103 + FAILURE_BACKOFF_MS });
		expect(store.delete).toHaveBeenCalledTimes(2);
	});

	it.each([undefined, "1"])(
		"drains overlapping writes to the latest generation (mode %s)",
		async (mode) => {
			const { env, store, sqlite, indexed } = fixture();
			if (mode) env.OCTO_VECTOR_SYNC_CONCURRENCY = mode;
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
			synchronizeVectors({ ...env, RESOURCE_ENV: "production" }, { now: 100 + FAILURE_BACKOFF_MS }),
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
