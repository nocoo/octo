import { afterEach, describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { runFtsChannel } from "./fts-channel";
import { backfillWordIndex } from "./word-backfill";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});

function fixture(count = 205) {
	const setup = sqliteD1();
	databases.push(setup.sqlite);
	for (let index = 0; index < count; index++) {
		setup.sqlite
			.prepare(
				"INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at) VALUES (?,'space:kb','旧文档','密钥轮换','note','k','hash',1,1)",
			)
			.run(`old-${String(index).padStart(4, "0")}`);
	}
	return setup;
}

describe("bounded word-index backfill", () => {
	it("resumes from durable keyset cursors, processes at most 100 rows, and is idempotent", async () => {
		const { db, sqlite } = fixture();
		const results = [];
		for (let attempt = 0; attempt < 4; attempt++) results.push(await backfillWordIndex(db));
		expect(results.map((result) => result.memories)).toEqual([100, 100, 5, 0]);
		expect(results[2]?.complete).toBe(true);
		expect(sqlite.prepare("SELECT count(*) AS count FROM memories_words_fts").get()?.count).toBe(
			205,
		);
		expect((await runFtsChannel(db, "密钥", ["space:kb"], undefined, 100)).hits).toHaveLength(100);
	});
	it("backfills tag tokens before memory tokens and excludes trash", async () => {
		const { db, sqlite } = fixture(2);
		sqlite.exec(
			"INSERT INTO tags VALUES ('tag','黑咖啡','黑咖啡',NULL,1,1); INSERT INTO memory_tags (memory_id,tag_id) VALUES ('old-0000','tag'); UPDATE memories SET deleted_at=1 WHERE id='old-0001'",
		);
		expect(await backfillWordIndex(db)).toMatchObject({ tags: 1, memories: 1, complete: true });
		expect(
			(await runFtsChannel(db, "黑咖啡", ["space:kb"], undefined, 10)).hits.map((hit) => hit.id),
		).toEqual(["old-0000"]);
	});
	it("rolls back tokens and progress together after a failed batch", async () => {
		const { db, sqlite } = fixture(1);
		sqlite.exec(
			"CREATE TRIGGER reject_map BEFORE INSERT ON memories_fts_map BEGIN SELECT RAISE(ABORT,'map failure'); END",
		);
		await expect(backfillWordIndex(db)).rejects.toThrow("map failure");
		expect(
			sqlite.prepare("SELECT memory_cursor FROM search_backfill_state").get()?.memory_cursor,
		).toBe("");
		expect(sqlite.prepare("SELECT count(*) AS count FROM memories_words_fts").get()?.count).toBe(0);
		sqlite.exec("DROP TRIGGER reject_map");
		expect(await backfillWordIndex(db)).toMatchObject({ memories: 1, complete: true });
	});
});
