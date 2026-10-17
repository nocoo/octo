import { describe, expect, it } from "vitest";
import { TagRepo } from "../tags";
import { migratedSqlite } from "./sqlite-d1";

function seedPair(
	raw: ReturnType<typeof migratedSqlite>["raw"],
	opts: { from: string; into: string; memFrom: string; memInto?: string },
): void {
	raw.exec(`
		INSERT INTO spaces (id, slug, name, description, created_at, updated_at)
		VALUES ('s1', 's1', 's1', '', 1, 1);
		INSERT INTO tags (id, name, display_name, merged_into, created_at, updated_at)
		VALUES ('ta', '${opts.from}', '${opts.from}', NULL, 1, 1),
		       ('tb', '${opts.into}', '${opts.into}', NULL, 1, 1);
		INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at)
		VALUES ('m1', 's1', 't', 'b', 'note', 0.5, 'k', 1, 'h', 1, 1);
		INSERT INTO memory_tags (memory_id, tag_id) VALUES ('m1', '${opts.memFrom}');
	`);
	if (opts.memInto) {
		raw.exec(`INSERT INTO memory_tags (memory_id, tag_id) VALUES ('m1', '${opts.memInto}')`);
	}
}

function ftsHits(raw: ReturnType<typeof migratedSqlite>["raw"], q: string): string[] {
	return (
		raw
			.prepare(
				`SELECT map.memory_id AS id FROM memories_fts f INNER JOIN memories_fts_map map ON map.fts_rowid = f.rowid WHERE memories_fts MATCH ?`,
			)
			.all(q) as Array<{ id: string }>
	).map((row) => row.id);
}

function ftsRowCount(raw: ReturnType<typeof migratedSqlite>["raw"]): number {
	return (raw.prepare("SELECT rowid FROM memories_fts").all() as Array<{ rowid: number }>).length;
}

describe("TagRepo on real sqlite", () => {
	it("rolls back a stale reverse merge with no side effects", async () => {
		const { raw, d1 } = migratedSqlite();
		seedPair(raw, { from: "from", into: "into", memFrom: "ta" });
		const repo = new TagRepo(d1, () => 9);
		await repo.merge("from", "into", "key:1");
		expect(
			raw.prepare("SELECT merged_into FROM tags WHERE id = 'ta'").get() as { merged_into: string },
		).toEqual({ merged_into: "tb" });
		repo.follow = async (row) => row;
		await expect(repo.merge("into", "from", "key:1")).rejects.toMatchObject({
			code: "unprocessable",
		});
		expect(
			raw.prepare("SELECT tag_id FROM memory_tags WHERE memory_id = 'm1'").all() as Array<{
				tag_id: string;
			}>,
		).toEqual([{ tag_id: "tb" }]);
		expect(
			(
				raw.prepare("SELECT merged_into FROM tags WHERE id = 'tb'").get() as {
					merged_into: string | null;
				}
			).merged_into,
		).toBeNull();
		expect(
			(
				raw.prepare("SELECT COUNT(*) AS n FROM changes WHERE op = 'tag_merged'").get() as {
					n: number;
				}
			).n,
		).toBe(1);
		raw.close();
	});

	it("rebuilds fts on mapped rowids so search stays joined", async () => {
		const { raw, d1 } = migratedSqlite();
		seedPair(raw, { from: "alpha", into: "beta", memFrom: "ta" });
		raw.exec(`
			INSERT INTO memories_fts(title, body, tags) VALUES('t', 'b', 'alpha');
			INSERT INTO memories_fts_map (memory_id, fts_rowid) VALUES ('m1', last_insert_rowid());
		`);
		const mapped = raw
			.prepare("SELECT fts_rowid FROM memories_fts_map WHERE memory_id = 'm1'")
			.get() as { fts_rowid: number };
		const repo = new TagRepo(d1, () => 20);
		await repo.rename("alpha", "gamma", "key:1");
		expect(ftsHits(raw, "gamma")).toEqual(["m1"]);
		expect(ftsHits(raw, "alpha")).toEqual([]);
		expect(
			(
				raw.prepare("SELECT fts_rowid FROM memories_fts_map WHERE memory_id = 'm1'").get() as {
					fts_rowid: number;
				}
			).fts_rowid,
		).toBe(mapped.fts_rowid);
		await repo.rename("gamma", "delta", "key:1");
		expect(ftsHits(raw, "delta")).toEqual(["m1"]);
		expect(ftsHits(raw, "gamma")).toEqual([]);
		expect(ftsRowCount(raw)).toBe(1);
		raw.close();
	});

	it("counts only this merge from batch meta.changes", async () => {
		const { raw, d1 } = migratedSqlite();
		raw.exec(`
			INSERT INTO spaces (id, slug, name, description, created_at, updated_at) VALUES ('s1', 's1', 's1', '', 1, 1);
			INSERT INTO tags (id, name, display_name, created_at, updated_at) VALUES
				('a', 'a', 'a', 1, 1), ('b', 'b', 'b', 1, 1), ('c', 'c', 'c', 1, 1), ('d', 'd', 'd', 1, 1);
			INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at)
			VALUES ('m1', 's1', 't', 'b', 'note', 0.5, 'k', 1, 'h', 1, 1),
			       ('m2', 's1', 't', 'b', 'note', 0.5, 'k', 1, 'h', 1, 1);
			INSERT INTO memory_tags (memory_id, tag_id) VALUES ('m1', 'a'), ('m2', 'c');
		`);
		const repo = new TagRepo(d1, () => 50);
		expect((await repo.merge("a", "b", "key:1")).memories).toBe(1);
		expect((await repo.merge("c", "d", "key:1")).memories).toBe(1);
		raw.close();
	});
});
