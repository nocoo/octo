import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import type { VectorQueryHit } from "../ports/vector/types";
import { encodeFloat32Vector } from "./math";
import { searchMemories } from "./service";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	for (const sqlite of databases.splice(0)) sqlite.close();
});

function fixture() {
	const { sqlite, db } = sqliteD1();
	databases.push(sqlite);
	sqlite.exec("UPDATE embedding_profiles SET dims = 2");
	function memory(id: string, vector = [1, 0], space = "space:kb") {
		sqlite
			.prepare(`INSERT INTO memories
			(id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at)
			VALUES (?, ?, 'vector memory', 'body', 'note', 'key', ?, 1, 1)`)
			.run(id, space, `hash:${id}`);
		sqlite
			.prepare(`INSERT INTO memory_vectors
			(memory_id, profile_id, embedding_model, dim, vector, content_hash, updated_at)
			SELECT ?, id, model, 2, ?, ?, 1 FROM embedding_profiles WHERE active = 1`)
			.run(id, encodeFloat32Vector(vector), `hash:${id}`);
	}
	function hit(id: string, score = 1): VectorQueryHit {
		const job = sqlite
			.prepare("SELECT generation FROM vector_sync_jobs WHERE memory_id = ?")
			.get(id);
		return { id, score, generation: Number(job?.generation), content_hash: `hash:${id}` };
	}
	const query = vi.fn(async () => ({ matches: [] as unknown[] }));
	const env = {
		DB: db,
		RESOURCE_ENV: "production",
		VEC: { query },
	} as unknown as Env;
	async function search(values = [1, 0], filters = {}, limit = 20) {
		return searchMemories(
			{ keyId: "key", visibleSpaceIds: ["space:kb"] },
			{ vector: { profile: "te3-small-1536", values }, mode: "vector", filters, limit },
			{ db, env },
		);
	}
	function external(hits: VectorQueryHit[]) {
		query.mockResolvedValue({
			matches: hits.map(({ generation, content_hash, ...rest }) => ({
				...rest,
				metadata: { generation, content_hash },
			})),
		});
	}
	function visible() {
		sqlite.exec("UPDATE vector_sync_jobs SET visible_generation = generation");
	}
	return { sqlite, db, memory, hit, query, external, visible, search };
}

describe("production vector convergence", () => {
	it("rejects stale generations, stale hashes and unverified Vectorize hits", async () => {
		const f = fixture();
		for (const id of ["generation", "hash", "legacy", "current"]) f.memory(id);
		f.visible();
		f.external([
			{ ...f.hit("generation"), generation: 0 },
			{ ...f.hit("hash"), content_hash: "old" },
			{ id: "legacy", score: 1 },
			f.hit("current"),
		]);
		const result = await f.search();
		expect(result.items.map((item) => item.id)).toEqual(["current"]);
		expect(result.channels.vector.candidates).toBe(1);
		expect(f.query).toHaveBeenCalledWith(
			[1, 0],
			expect.objectContaining({ returnMetadata: "all", topK: 50 }),
		);
	});

	it("rescores current D1 vectors and deduplicates before ranks and limits", async () => {
		const f = fixture();
		f.memory("best");
		f.memory("second", [0.6, 0.8]);
		f.visible();
		f.external([f.hit("second", 1), f.hit("second", 0.99), f.hit("best", 0.01)]);
		const result = await f.search([1, 0], {}, 2);
		expect(result.items.map((item) => item.id)).toEqual(["best", "second"]);
		expect(result.items.map((item) => item.scores.vector?.rank)).toEqual([1, 2]);
		expect(result.items[0]?.scores.vector?.similarity).toBeCloseTo(1);
		expect(result.items[1]?.scores.vector?.similarity).toBeCloseTo(0.6);
		expect(result.channels.vector.candidates).toBe(2);
	});

	it("excludes verified zero/negative cosine and missing vectors before ranking", async () => {
		const f = fixture();
		f.memory("orthogonal", [0, 1]);
		f.memory("opposite", [-1, 0]);
		f.visible();
		f.external([f.hit("orthogonal"), f.hit("opposite"), f.hit("missing")]);
		expect((await f.search()).items).toEqual([]);
	});

	it("merges the same current vector from Vectorize and the overlay only once", async () => {
		const f = fixture();
		f.memory("pending");
		f.external([f.hit("pending")]);
		const result = await f.search();
		expect(result.items.map((item) => item.id)).toEqual(["pending"]);
		expect(result.channels.vector.candidates).toBe(1);
		expect(result.items[0]?.scores.vector?.rank).toBe(1);
	});

	it("overlays new vectors until visibility is confirmed, without a recency expiry or writes", async () => {
		const f = fixture();
		f.memory("pending");
		f.sqlite.exec(`UPDATE memory_vectors SET indexed_at = 1;
			UPDATE vector_sync_jobs SET synced_generation = generation, due_at = 9999999999999`);
		const before = f.sqlite.prepare("SELECT total_changes() AS count").get()?.count;
		const result = await f.search();
		expect(result.items.map((item) => item.id)).toEqual(["pending"]);
		expect(f.sqlite.prepare("SELECT total_changes() AS count").get()?.count).toBe(before);
		f.visible();
		expect((await f.search()).items).toEqual([]);
	});

	it("uses the replacement vector during propagation and excludes zero/negative cosine", async () => {
		const f = fixture();
		f.memory("updated");
		const stale = f.hit("updated");
		f.visible();
		f.sqlite
			.prepare("UPDATE memory_vectors SET vector = ? WHERE memory_id = 'updated'")
			.run(encodeFloat32Vector([0, 1]));
		f.external([stale]);
		expect((await f.search([1, 0])).items).toEqual([]);
		expect((await f.search([0, -1])).items).toEqual([]);
		const result = await f.search([0, 1]);
		expect(result.items.map((item) => item.id)).toEqual(["updated"]);
		expect(result.items[0]?.scores.vector?.similarity).toBeCloseTo(1);
	});

	it("never overlays a vector for stale content, wrong model or wrong dimension", async () => {
		const f = fixture();
		for (const id of ["stale", "model", "dimension"]) f.memory(id);
		f.external([f.hit("stale"), f.hit("model"), f.hit("dimension")]);
		f.sqlite.exec(`UPDATE memories SET content_hash = 'new' WHERE id = 'stale';
			UPDATE memory_vectors SET embedding_model = 'wrong' WHERE memory_id = 'model';
			UPDATE memory_vectors SET dim = 1 WHERE memory_id = 'dimension'`);
		expect((await f.search()).items).toEqual([]);
	});

	it("applies permissions, trash and all content filters to the overlay", async () => {
		const f = fixture();
		for (const id of ["allowed", "trash", "type", "source", "importance", "time", "tag"])
			f.memory(id);
		f.memory("hidden", [1, 0], "space:other");
		f.sqlite.exec(`UPDATE memories SET deleted_at = 2 WHERE id = 'trash';
			UPDATE memories SET type = 'task' WHERE id = 'type';
			UPDATE memories SET source_key_id = 'other' WHERE id = 'source';
			UPDATE memories SET importance = 0 WHERE id = 'importance';
			UPDATE memories SET updated_at = 0 WHERE id = 'time';
			INSERT INTO tags VALUES ('tag', 'infra', 'Infra', NULL, 1, 1);
			INSERT INTO memory_tags (memory_id, tag_id)
			SELECT id, 'tag' FROM memories WHERE id != 'tag'`);
		const result = await f.search([1, 0], {
			types: ["note"],
			sources: ["key"],
			importance: { min: 0.5 },
			time: { field: "updated", from: "1970-01-01T00:00:00.001Z" },
			tags_all: ["infra"],
		});
		expect(result.items.map((item) => item.id)).toEqual(["allowed"]);
		expect(result.channels.vector.candidates).toBe(1);
	});

	it("only flags metadata-cap truncation when tags actually remove verified candidates", async () => {
		const f = fixture();
		const ids = Array.from({ length: 50 }, (_, i) => `m${i}`);
		for (const id of ids) f.memory(id);
		f.visible();
		f.external(ids.map((id) => f.hit(id)));
		f.sqlite.exec(`INSERT INTO tags VALUES ('infra', 'infra', 'Infra', NULL, 1, 1);
			INSERT INTO memory_tags (memory_id, tag_id) SELECT id, 'infra' FROM memories`);
		expect((await f.search([1, 0], { tags_all: ["infra"] })).channels.vector).toMatchObject({
			candidates: 50,
			truncated: false,
		});
		f.sqlite.exec("DELETE FROM memory_tags");
		expect((await f.search([1, 0], { tags_all: ["infra"] })).channels.vector).toMatchObject({
			candidates: 0,
			truncated: true,
		});
	});

	it("scans pending generations in bounded pages without a latest-N recall window", async () => {
		const f = fixture();
		for (let i = 0; i < 225; i++) f.memory(`a${String(i).padStart(3, "0")}`, [0.1, 1]);
		f.memory("z-old-best");
		const prepare = vi.spyOn(f.db, "prepare");
		const result = await f.search([1, 0], {}, 1);
		expect(result.items[0]?.id).toBe("z-old-best");
		const overlayCalls = prepare.mock.calls.filter(([sql]) => sql.includes("visible_generation"));
		expect(overlayCalls.length).toBeGreaterThanOrEqual(3);
		for (const [sql] of overlayCalls) expect(sql).toContain("LIMIT");
	});
});
