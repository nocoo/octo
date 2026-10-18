import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { purgeMemory } from "../purge/service";
import { MemoryRepo, type MemoryWrite } from "../repo/memories";
import { TagRepo } from "../repo/tags";
import { runFtsChannel } from "./fts-channel";
import { backfillWordIndex, WORD_BACKFILL_BYTES } from "./word-backfill";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});

function setup() {
	const fixture = sqliteD1();
	databases.push(fixture.sqlite);
	const repo = new MemoryRepo(fixture.db);
	const tags = new TagRepo(fixture.db);
	const write: MemoryWrite = {
		id: "memory",
		spaceId: "space:kb",
		title: "咖啡",
		body: "他早上只喝黑咖啡",
		type: "note",
		importance: 0.5,
		eventTime: null,
		tags: [],
		actor: "key:k",
		sourceKeyId: "k",
		updatedByKeyId: "k",
		op: "create",
		now: 1,
	};
	const hits = async (query: string, space = "space:kb") =>
		(await runFtsChannel(fixture.db, query, [space], undefined, 10)).hits.map((hit) => hit.id);
	return { ...fixture, repo, tags, write, hits };
}

describe("transactional word index", () => {
	it("stays synchronized through create, update, move, trash, restore and purge", async () => {
		const { db, sqlite, repo, write, hits } = setup();
		await repo.write(write);
		expect(await hits("咖啡")).toEqual([write.id]);
		const next = {
			...write,
			title: "绿茶",
			body: "晚上喝绿茶",
			op: "update" as const,
			expectedVersion: 1,
			now: 2,
		};
		await repo.write(next);
		expect(await hits("咖啡")).toEqual([]);
		expect(await hits("绿茶")).toEqual([write.id]);
		await repo.write({ ...next, op: "move", spaceId: "space:dest", expectedVersion: 2, now: 3 });
		expect(await hits("绿茶")).toEqual([]);
		expect(await hits("绿茶", "space:dest")).toEqual([write.id]);
		await repo.trash(write.id, "key:k", 4, { version: 3, spaceId: "space:dest" });
		expect(sqlite.prepare("SELECT count(*) AS count FROM memories_words_fts").get()?.count).toBe(0);
		await repo.write({ ...next, op: "restore", spaceId: "space:dest", expectedVersion: 3, now: 5 });
		expect(await hits("绿茶", "space:dest")).toEqual([write.id]);
		await repo.trash(write.id, "key:k", 6, { version: 4, spaceId: "space:dest" });
		await purgeMemory(db, write.id, "admin:test");
		expect(sqlite.prepare("SELECT count(*) AS count FROM memories_words_fts").get()?.count).toBe(0);
		expect(sqlite.prepare("SELECT count(*) AS count FROM memories_fts_map").get()?.count).toBe(0);
	});

	it("updates word tokens for staged tags, rename and merge without reindexing trash", async () => {
		const { db, sqlite, repo, tags, write, hits } = setup();
		const statements: D1PreparedStatement[] = [];
		const stagedTags = new TagRepo(db, undefined, undefined, statements);
		const resolved = await stagedTags.resolveMany(["备份存储"]);
		const staged = new MemoryRepo(db, (batch) => statements.push(...batch));
		await staged.write({ ...write, tags: resolved });
		await db.batch(statements);
		expect(await hits("存储")).toEqual([write.id]);
		await db.batch((await tags.rename("备份存储", "部署指南", "key:k")).statements);
		expect(await hits("存储")).toEqual([]);
		expect(await hits("部署")).toEqual([write.id]);
		await tags.resolveMany(["轮换策略"]);
		await db.batch((await tags.merge("部署指南", "轮换策略", "key:k")).statements);
		expect(await hits("部署")).toEqual([]);
		expect(await hits("轮换")).toEqual([write.id]);
		await repo.trash(write.id, "key:k", 2, { version: 1, spaceId: "space:kb" });
		await db.batch((await tags.rename("轮换策略", "更新策略", "key:k")).statements);
		expect(sqlite.prepare("SELECT count(*) AS count FROM memories_words_fts").get()?.count).toBe(0);
	});

	it("does not leak index changes from failed memory transactions", async () => {
		const { sqlite, repo, write, hits } = setup();
		await repo.write(write);
		sqlite.exec(
			"CREATE TRIGGER reject_change BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT,'change failure'); END",
		);
		await expect(
			repo.write({
				...write,
				title: "敏感",
				body: "秘密",
				op: "update",
				expectedVersion: 1,
				now: 2,
			}),
		).rejects.toThrow();
		expect(await hits("秘密")).toEqual([]);
		expect(await hits("咖啡")).toEqual([write.id]);
		expect(sqlite.prepare("SELECT version FROM memories").get()?.version).toBe(1);
	});

	it("does not overwrite a concurrent write with a stale backfill snapshot", async () => {
		const { db, repo, write, hits } = setup();
		await repo.write(write);
		const batch = db.batch.bind(db);
		let mutated = false;
		vi.spyOn(db, "batch").mockImplementation(async (statements) => {
			if (
				!mutated &&
				(statements[0] as unknown as { sql: string }).sql.includes("INSERT INTO memories_fts_map")
			) {
				mutated = true;
				await repo.write({
					...write,
					title: "绿茶",
					body: "绿茶",
					op: "update",
					expectedVersion: 1,
					now: 2,
				});
			}
			return batch(statements);
		});
		expect(await backfillWordIndex(db)).toMatchObject({ complete: true });
		expect(mutated).toBe(true);
		expect(await hits("咖啡")).toEqual([]);
		expect(await hits("绿茶")).toEqual([write.id]);
	});

	it("bounds backfill source bytes and still advances a single oversized row", async () => {
		const { db, sqlite } = setup();
		const insert = sqlite.prepare(
			"INSERT INTO memories(id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at) VALUES (?,'space:kb','',?,'note','k','h',1,1)",
		);
		for (let index = 0; index < 6; index++)
			insert.run(`m${index}`, "x".repeat(WORD_BACKFILL_BYTES / 4));
		expect(await backfillWordIndex(db)).toMatchObject({ memories: 4, complete: false });
		expect(await backfillWordIndex(db)).toMatchObject({ memories: 2, complete: true });
		sqlite.exec("UPDATE search_backfill_state SET complete=0");
		insert.run("z", "x".repeat(WORD_BACKFILL_BYTES + 1));
		expect(await backfillWordIndex(db)).toMatchObject({ memories: 1, complete: true });
	});
});
