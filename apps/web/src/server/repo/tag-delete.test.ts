import { afterEach, describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import { commitTagWrite } from "./__tests__/tag-write";
import { TagRepo } from "./tags";

const databases: ReturnType<typeof sqliteD1>["sqlite"][] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

function fixture() {
	const f = sqliteD1();
	databases.push(f.sqlite);
	f.sqlite.exec(
		"INSERT INTO tags (id,name,display_name,created_at,updated_at) VALUES ('unused','unused','Unused',1,1),('other','other','Other',1,1)",
	);
	return { ...f, repo: new TagRepo(f.db) };
}

describe("staged tag deletion", () => {
	it("normalizes names and stages deletion without committing or changing other tags", async () => {
		const { db, sqlite, repo } = fixture();
		const write = await repo.remove("  ＵＮＵＳＥＤ  ");
		expect(write.value).toEqual({ name: "unused", deleted: true });
		expect(sqlite.prepare("SELECT id FROM tags ORDER BY id").all()).toEqual([
			{ id: "other" },
			{ id: "unused" },
		]);
		await db.batch(write.statements);
		expect(sqlite.prepare("SELECT id FROM tags").all()).toEqual([{ id: "other" }]);
		expect(sqlite.prepare("SELECT * FROM changes").all()).toEqual([]);
	});

	it("returns not_found for a missing name and validates normalized names", async () => {
		const { repo } = fixture();
		await expect(repo.remove("missing")).rejects.toMatchObject({ code: "not_found" });
		for (const name of [" ", "x".repeat(65)])
			await expect(repo.remove(name)).rejects.toMatchObject({ code: "validation_failed" });
	});

	it.each([null, 2])(
		"rejects references from any space, including deleted_at=%s",
		async (deletedAt) => {
			const { repo, sqlite } = fixture();
			sqlite
				.prepare(
					"INSERT INTO memories (id,space_id,title,body,type,importance,source_key_id,content_hash,created_at,updated_at,deleted_at) VALUES ('m','space:dest','t','b','note',0.5,'other','h',1,1,?)",
				)
				.run(deletedAt);
			sqlite.exec("INSERT INTO memory_tags (memory_id,tag_id) VALUES ('m','unused')");
			await expect(repo.remove("unused")).rejects.toMatchObject({
				code: "tag_in_use",
				status: 409,
			});
			expect(sqlite.prepare("SELECT tag_id FROM memory_tags").all()).toEqual([
				{ tag_id: "unused" },
			]);
		},
	);

	it("protects incoming alias chains and deletes only the named unused alias", async () => {
		const { repo, sqlite, db } = fixture();
		sqlite.exec(
			"INSERT INTO tags (id,name,display_name,merged_into,created_at,updated_at) VALUES ('alias','alias','Alias','unused',1,1),('leaf','leaf','Leaf','alias',1,1)",
		);
		for (const name of ["unused", "alias"])
			await expect(repo.remove(name)).rejects.toMatchObject({ code: "tag_in_use", status: 409 });
		await expect(commitTagWrite(db, repo.remove("leaf"))).resolves.toEqual({
			name: "leaf",
			deleted: true,
		});
		expect(sqlite.prepare("SELECT merged_into FROM tags WHERE id='alias'").get()).toEqual({
			merged_into: "unused",
		});
		await commitTagWrite(db, repo.remove("alias"));
		expect(sqlite.prepare("SELECT id FROM tags ORDER BY id").all()).toEqual([
			{ id: "other" },
			{ id: "unused" },
		]);
		await commitTagWrite(db, repo.remove("unused"));
		expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	});

	it.each(["live-use", "trash-use", "alias", "rename", "replacement"])(
		"aborts a prepared deletion on a concurrent %s without changing the winner",
		async (race) => {
			const { repo, sqlite, db } = fixture();
			const write = await repo.remove("unused");
			if (race === "live-use" || race === "trash-use") {
				sqlite.exec(
					"INSERT INTO memories (id,space_id,title,body,type,importance,source_key_id,content_hash,created_at,updated_at) VALUES ('m','space:dest','t','b','note',0.5,'other','h',1,1)",
				);
				if (race === "trash-use") sqlite.exec("UPDATE memories SET deleted_at=2 WHERE id='m'");
				sqlite.exec("INSERT INTO memory_tags (memory_id,tag_id) VALUES ('m','unused')");
			} else if (race === "alias") {
				sqlite.exec(
					"INSERT INTO tags (id,name,display_name,merged_into,created_at,updated_at) VALUES ('alias','alias','Alias','unused',1,1)",
				);
			} else if (race === "rename") {
				sqlite.exec("UPDATE tags SET name='winner',updated_at=2 WHERE id='unused'");
			} else {
				sqlite.exec(
					"DELETE FROM tags WHERE id='unused'; INSERT INTO tags (id,name,display_name,created_at,updated_at) VALUES ('replacement','unused','Replacement',1,1)",
				);
			}
			const before = sqlite.prepare("SELECT * FROM tags ORDER BY id").all();
			await expect(
				db.batch(write.statements).catch((error: unknown) => {
					throw write.mapError(error) ?? error;
				}),
			).rejects.toMatchObject({ code: "tag_in_use", status: 409 });
			expect(sqlite.prepare("SELECT * FROM tags ORDER BY id").all()).toEqual(before);
			expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
		},
	);

	it("does not map unrelated SQL failures to tag_in_use", async () => {
		const { repo } = fixture();
		const write = await repo.remove("unused");
		for (const error of [
			new Error("storage failed"),
			new Error("FOREIGN KEY constraint failed"),
			new Error("NOT NULL constraint failed: unrelated.value"),
		])
			expect(write.mapError(error)).toBeUndefined();
	});
});
