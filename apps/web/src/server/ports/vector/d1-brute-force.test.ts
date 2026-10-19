import { afterEach, describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../../tests/fixtures/sqlite-d1";
import { encodeFloat32Vector, l2Normalize } from "../../search/math";
import { D1BruteForceVectorStore } from "./d1-brute-force";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	for (const sqlite of databases.splice(0)) sqlite.close();
});

describe("D1BruteForceVectorStore", () => {
	it("leaves D1 writes to the authoritative memory transaction", async () => {
		const store = new D1BruteForceVectorStore({} as D1Database, "profile", {
			clauses: ["1 = 1"],
			binds: [],
		});
		await expect(store.upsert([{ id: "memory", values: [1, 0] }])).resolves.toBeUndefined();
		await expect(store.delete(["memory"])).resolves.toBeUndefined();
	});

	it("only scores vectors matching current content and profile model/dimension", async () => {
		const { sqlite, db } = sqliteD1();
		databases.push(sqlite);
		sqlite.exec("UPDATE embedding_profiles SET model = 'model', dims = 2");
		for (const id of ["current", "stale", "model", "dimension"]) {
			sqlite
				.prepare(`INSERT INTO memories
				(id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at)
				VALUES (?, 'space:kb', 't', 'b', 'note', 'key', 'hash', 1, 1)`)
				.run(id);
			sqlite
				.prepare(`INSERT INTO memory_vectors
				(memory_id, profile_id, embedding_model, dim, vector, content_hash, updated_at)
				VALUES (?, 'te3-small-1536', 'model', 2, ?, 'hash', 1)`)
				.run(id, encodeFloat32Vector([1, 0]));
		}
		sqlite.exec(`UPDATE memory_vectors SET content_hash = 'old' WHERE memory_id = 'stale';
			UPDATE memory_vectors SET embedding_model = 'wrong' WHERE memory_id = 'model';
			UPDATE memory_vectors SET dim = 1 WHERE memory_id = 'dimension'`);
		const store = new D1BruteForceVectorStore(db, "te3-small-1536", {
			clauses: ["m.deleted_at IS NULL"],
			binds: [],
		});
		expect(
			(await store.query({ vector: [1, 0], topK: 10, returnMetadata: false })).map((hit) => hit.id),
		).toEqual(["current"]);
	});

	it("scores vectors with cosine dot product", async () => {
		const a = l2Normalize([1, 0]);
		const b = l2Normalize([0.9, 0.1]);
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{ memory_id: "m1", dim: 2, vector: encodeFloat32Vector(a).buffer },
							{ memory_id: "m2", dim: 2, vector: encodeFloat32Vector(b).buffer },
						],
					}),
				}),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", {
			clauses: ["1 = 1"],
			binds: [],
		});
		const hits = await store.query({ vector: a, topK: 10, returnMetadata: false });
		expect(hits[0]?.id).toBe("m1");
		expect(hits[0]?.score).toBeCloseTo(1);
	});

	it("computes true cosine for scaled queries and stored vectors", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{ memory_id: "same", dim: 2, vector: encodeFloat32Vector([3, 4]).buffer },
							{ memory_id: "opposite", dim: 2, vector: encodeFloat32Vector([-3, -4]).buffer },
						],
					}),
				}),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", { clauses: ["1=1"], binds: [] });
		const hits = await store.query({ vector: [3e300, 4e300], topK: 10, returnMetadata: false });
		expect(hits.map((hit) => hit.id)).toEqual(["same", "opposite"]);
		expect(hits[0]?.score).toBeCloseTo(1, 12);
		expect(hits[1]?.score).toBeCloseTo(-1, 12);
		await expect(store.query({ vector: [1], topK: 1, returnMetadata: false })).rejects.toThrow(
			"dimension",
		);
	});

	it("handles missing result sets and metadata topK", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ all: async () => ({}) }),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", { clauses: ["1=1"], binds: [] });
		expect(await store.query({ vector: [1, 0], topK: 80, returnMetadata: true })).toEqual([]);
	});

	it("returns an empty list when no rows match", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ all: async () => ({ results: [] }) }),
			}),
		} as never;
		const store = new D1BruteForceVectorStore(db, "p1", { clauses: ["1=1"], binds: [] });
		expect(await store.query({ vector: [1, 0], topK: 3, returnMetadata: false })).toEqual([]);
	});
});
