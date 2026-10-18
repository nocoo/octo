import { afterEach, describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { MemoryRepo, type MemoryWrite } from "../repo/memories";
import { runFtsChannel } from "./fts-channel";
import { searchMemories } from "./service";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});

function memory(id: string, body: string, extra: Partial<MemoryWrite> = {}): MemoryWrite {
	return {
		id,
		body,
		title: "",
		spaceId: "space:kb",
		type: "note",
		importance: 0.5,
		eventTime: null,
		tags: [],
		actor: "key:k",
		sourceKeyId: "k",
		updatedByKeyId: "k",
		op: "create",
		now: 1,
		...extra,
	};
}

describe("indexed short-compound recall", () => {
	it.each([
		["周会是什么时候", "周会议程写明每周三下午两点", "周末开会"],
		["咖啡", "咖啡豆放在密封罐里", "咖喱配啡色盘子"],
	])(
		"finds old %s across ICU boundaries before limiting candidates",
		async (query, body, noise) => {
			const { db, sqlite } = sqliteD1();
			databases.push(sqlite);
			const repo = new MemoryRepo(db);
			await repo.write(memory("old-answer", body));
			for (let index = 0; index < 510; index++) {
				await repo.write(memory(`noise-${index}`, noise, { now: index + 100 }));
			}
			for (const mode of ["fts", "hybrid"] as const) {
				const result = await searchMemories(
					{ keyId: "k", visibleSpaceIds: ["space:kb"] },
					{
						query,
						mode,
						limit: 1,
						vector: { profile: "te3-small-1536", values: [1, ...Array<number>(1535).fill(0)] },
					},
					{ db, vectorStore: { query: async () => [] } },
				);
				expect(result.items.map((item) => item.id)).toEqual(["old-answer"]);
			}
			expect(
				(await runFtsChannel(db, query, ["space:kb"], undefined, 1)).hits.map((hit) => hit.id),
			).toEqual(["old-answer"]);
		},
	);

	it("verifies each short term in one field and preserves mixed AND/OR semantics", async () => {
		const { db, sqlite } = sqliteD1();
		databases.push(sqlite);
		const repo = new MemoryRepo(db);
		await repo.write(memory("body", "咖啡豆 backup"));
		await repo.write(memory("or-only", "咖啡"));
		await repo.write(memory("title", "tea", { title: "周会议程" }));
		await repo.write(memory("separate-fields", "会", { title: "周" }));
		await repo.write(memory("separate-words", "周末开会 espresso"));
		expect(
			(await runFtsChannel(db, "咖啡 backup", ["space:kb"], undefined, 10)).hits.map(
				(hit) => hit.id,
			),
		).toEqual(["body"]);
		expect(
			(await runFtsChannel(db, "周会 absent", ["space:kb"], undefined, 10)).hits.map(
				(hit) => hit.id,
			),
		).toEqual(["title"]);
		expect((await runFtsChannel(db, "周会", ["space:kb"], { types: ["other"] }, 10)).hits).toEqual(
			[],
		);
		expect((await runFtsChannel(db, "周会", ["hidden"], undefined, 10)).hits).toEqual([]);
		sqlite.exec("UPDATE memories SET deleted_at=2 WHERE id='title'");
		expect((await runFtsChannel(db, "周会", ["space:kb"], undefined, 10)).hits).toEqual([]);
	});

	it("verifies contiguous canonical tags without concatenating separate tags", async () => {
		const { db, sqlite } = sqliteD1();
		databases.push(sqlite);
		sqlite.exec(
			"INSERT INTO tags VALUES ('t1','周会议程','Agenda',NULL,1,1), ('t2','周','Week',NULL,1,1), ('t3','会','Meet',NULL,1,1)",
		);
		const repo = new MemoryRepo(db);
		await repo.write(memory("tag-answer", "tea", { tags: [{ id: "t1", name: "周会议程" }] }));
		await repo.write(
			memory("tag-noise", "tea", {
				tags: [
					{ id: "t2", name: "周" },
					{ id: "t3", name: "会" },
				],
			}),
		);
		expect(
			(await runFtsChannel(db, "周会", ["space:kb"], undefined, 1)).hits.map((hit) => hit.id),
		).toEqual(["tag-answer"]);
	});
});
