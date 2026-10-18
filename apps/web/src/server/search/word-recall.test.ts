import { afterEach, describe, expect, it } from "vitest";
import { SEARCH_QUESTIONS as fixtures } from "../../../../../tests/fixtures/search-questions";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { MemoryRepo, type MemoryWrite } from "../repo/memories";
import { searchMemories } from "./service";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});

export function recallWrite(id: string, body: string, now = 1): MemoryWrite {
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
		now,
	};
}

describe("word-index question recall", () => {
	it("ranks old answers first in fts and hybrid beyond 500 newer distractors", async () => {
		const { db, sqlite } = sqliteD1();
		databases.push(sqlite);
		const repo = new MemoryRepo(db);
		for (const fixture of fixtures) await repo.write(recallWrite(fixture.id, fixture.body));
		for (let index = 0; index < 510; index++) {
			await repo.write(
				recallWrite(
					`noise-${index}`,
					[
						"早上散步晚上泡茶",
						"周末开会",
						"服务器运行状态",
						"猫喜欢玩耍",
						"D1价格",
						"轮换值班",
						"coffee grinder",
						"keys keyboard",
					][index % 8] as string,
					index + 100,
				),
			);
		}
		for (const fixture of fixtures) {
			for (const query of fixture.questions) {
				for (const mode of ["fts", "hybrid"] as const) {
					const result = await searchMemories(
						{ keyId: "k", visibleSpaceIds: ["space:kb"] },
						{
							query,
							mode,
							...(mode === "hybrid"
								? {
										vector: {
											profile: "te3-small-1536",
											values: [1, ...Array<number>(1535).fill(0)],
										},
									}
								: {}),
						},
						{ db, vectorStore: { query: async () => [] } },
					);
					expect(result.items[0]?.id, `${mode}: ${query}`).toBe(fixture.id);
					expect(result.channels.fts.partial).toBe(false);
					expect(result.channels.fts.partial_reason).toBeNull();
				}
			}
		}
	});
});
