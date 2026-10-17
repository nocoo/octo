import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { asD1, FakeD1 } from "./__tests__/fake-d1";
import { commitTagWrite } from "./__tests__/tag-write";
import { normalizeTag, TagRepo, tagDisplayName } from "./tags";

describe("normalizeTag", () => {
	it("trims, applies NFKC, and lowercases latin only", () => {
		expect(normalizeTag("  Infra  ")).toBe("infra");
		expect(normalizeTag("Caddy")).toBe("caddy");
		expect(normalizeTag("运维")).toBe("运维");
		expect(normalizeTag("  标签A  ")).toBe("标签a");
		expect(normalizeTag("ﬁle")).toBe("file");
	});

	it("rejects empty and overlong names", () => {
		expect(() => normalizeTag("   ")).toThrow(ApiError);
		expect(() => normalizeTag("")).toThrow(ApiError);
		expect(() => normalizeTag("x".repeat(65))).toThrow(ApiError);
		expect(normalizeTag(` ${"x".repeat(64)} `)).toBe("x".repeat(64));
	});
});

describe("tagDisplayName", () => {
	it("preserves latin case after trim and NFKC", () => {
		expect(tagDisplayName("  Infra  ")).toBe("Infra");
		expect(tagDisplayName("ﬁle")).toBe("file");
	});

	it("rejects empty display names", () => {
		expect(() => tagDisplayName("  ")).toThrow(ApiError);
		expect(() => tagDisplayName("y".repeat(65))).toThrow(ApiError);
	});
});

describe("TagRepo", () => {
	it("creates or gets tags and follows merged_into", async () => {
		const db = new FakeD1();
		const repo = new TagRepo(
			asD1(db),
			() => 10,
			() => "id1",
		);
		const [created] = await repo.resolveMany(["Infra"]);
		expect(created?.name).toBe("infra");
		expect(created?.display_name).toBe("Infra");
		const repo2 = new TagRepo(
			asD1(db),
			() => 11,
			() => "id2",
		);
		const [again, dup] = await repo2.resolveMany(["INFRA", "infra"]);
		expect(again?.id).toBe(created?.id);
		expect(dup).toBeUndefined();
		const alias = {
			id: "alias",
			name: "old",
			display_name: "old",
			merged_into: created?.id ?? "",
			created_at: 1,
			updated_at: 1,
		};
		db.tags.set("alias", alias);
		const [redirected] = await repo2.resolveMany(["old"]);
		expect(redirected?.id).toBe(created?.id);
	});

	it("counts uses only in visible live memories", async () => {
		const db = new FakeD1();
		db.tags.set("t1", {
			id: "t1",
			name: "infra",
			display_name: "infra",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		db.tags.set("t2", {
			id: "t2",
			name: "gone",
			display_name: "gone",
			merged_into: "t1",
			created_at: 1,
			updated_at: 1,
		});
		db.memories.set("m1", { id: "m1", space_id: "s1", deleted_at: null });
		db.memories.set("m2", { id: "m2", space_id: "s2", deleted_at: null });
		db.memories.set("m3", { id: "m3", space_id: "s1", deleted_at: 9 });
		db.memoryTags.push(
			{ memory_id: "m1", tag_id: "t1" },
			{ memory_id: "m2", tag_id: "t1" },
			{ memory_id: "m3", tag_id: "t1" },
		);
		const repo = new TagRepo(asD1(db));
		expect(await repo.listWithCounts({ kind: "ids", ids: [] })).toEqual([
			{ id: "t1", name: "infra", display_name: "infra", use_count: 0 },
		]);
		expect(await repo.listWithCounts({ kind: "ids", ids: ["s1"] })).toEqual([
			{ id: "t1", name: "infra", display_name: "infra", use_count: 1 },
		]);
		expect(await repo.listWithCounts({ kind: "all" })).toEqual([
			{ id: "t1", name: "infra", display_name: "infra", use_count: 2 },
		]);
		const many = new FakeD1();
		many.tags.set("t1", db.tags.get("t1") as never);
		const ids = Array.from({ length: 101 }, (_, i) => `sp${i}`);
		for (const id of ids) {
			many.spaces.set(id, {
				id,
				slug: id,
				name: id,
				description: "",
				owner_key_id: null,
				created_at: 1,
				updated_at: 1,
			});
		}
		many.memories.set("m1", { id: "m1", space_id: "sp0", deleted_at: null });
		many.memoryTags.push({ memory_id: "m1", tag_id: "t1" });
		expect(await new TagRepo(asD1(many)).listWithCounts({ kind: "all" })).toEqual([
			{ id: "t1", name: "infra", display_name: "infra", use_count: 1 },
		]);
		expect(await new TagRepo(asD1(many)).listWithCounts({ kind: "ids", ids })).toEqual([
			{ id: "t1", name: "infra", display_name: "infra", use_count: 1 },
		]);
		const dupDb = new FakeD1();
		dupDb.tags.set("t1", db.tags.get("t1") as never);
		dupDb.spaces.set("dup", {
			id: "dup",
			slug: "dup",
			name: "dup",
			description: "",
			owner_key_id: null,
			created_at: 1,
			updated_at: 1,
		});
		for (let i = 0; i < 99; i++) {
			const id = `other${i}`;
			dupDb.spaces.set(id, {
				id,
				slug: id,
				name: id,
				description: "",
				owner_key_id: null,
				created_at: 1,
				updated_at: 1,
			});
		}
		dupDb.memories.set("m-dup", { id: "m-dup", space_id: "dup", deleted_at: null });
		dupDb.memoryTags.push({ memory_id: "m-dup", tag_id: "t1" });
		const spanning = ["dup", ...Array.from({ length: 99 }, (_, i) => `other${i}`), "dup"];
		expect(await new TagRepo(asD1(dupDb)).listWithCounts({ kind: "ids", ids: spanning })).toEqual([
			{ id: "t1", name: "infra", display_name: "infra", use_count: 1 },
		]);
	});

	it("renames or returns tag_conflict suggesting merge", async () => {
		const db = new FakeD1();
		db.tags.set("a", {
			id: "a",
			name: "old",
			display_name: "old",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		db.tags.set("b", {
			id: "b",
			name: "taken",
			display_name: "taken",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		const repo = new TagRepo(asD1(db), () => 50);
		await expect(
			commitTagWrite(asD1(db), repo.rename("missing", "n", "key:1")),
		).rejects.toBeInstanceOf(ApiError);
		try {
			await commitTagWrite(asD1(db), repo.rename("old", "taken", "key:1"));
			throw new Error("expected conflict");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			expect((err as ApiError).code).toBe("tag_conflict");
			expect((err as ApiError).details).toEqual({ suggest: "merge", into: "taken" });
		}
		const renamed = await commitTagWrite(asD1(db), repo.rename("old", "New", "key:1"));
		expect(renamed.name).toBe("new");
		expect(renamed.display_name).toBe("New");
		expect(db.changes).toHaveLength(1);
		const same = await commitTagWrite(asD1(db), repo.rename("new", "NEW", "key:1"));
		expect(same.id).toBe("a");
		db.hiddenNames.add("taken");
		await expect(
			commitTagWrite(asD1(db), repo.rename("new", "taken", "key:1")),
		).rejects.toMatchObject({
			code: "tag_conflict",
		});
	});

	it("merges tags in one batch with dedupe and change rows", async () => {
		const db = new FakeD1();
		db.tags.set("a", {
			id: "a",
			name: "from",
			display_name: "from",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		db.tags.set("b", {
			id: "b",
			name: "into",
			display_name: "into",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		db.memories.set("m1", { id: "m1", space_id: "s1", deleted_at: null });
		db.memories.set("m2", { id: "m2", space_id: "s1", deleted_at: null });
		db.memoryTags.push(
			{ memory_id: "m1", tag_id: "a" },
			{ memory_id: "m1", tag_id: "b" },
			{ memory_id: "m2", tag_id: "a" },
		);
		const repo = new TagRepo(asD1(db), () => 9);
		const result = await commitTagWrite(asD1(db), repo.merge("from", "into", "key:1"));
		expect(result.memories).toBe(2);
		expect(db.tags.get("a")?.merged_into).toBe("b");
		expect(db.memoryTags).toEqual([
			{ memory_id: "m1", tag_id: "b" },
			{ memory_id: "m2", tag_id: "b" },
		]);
		expect(db.changes).toHaveLength(2);
		await expect(
			commitTagWrite(asD1(db), repo.merge("into", "into", "key:1")),
		).rejects.toMatchObject({
			code: "validation_failed",
		});
		await expect(
			commitTagWrite(asD1(db), repo.merge("missing", "into", "key:1")),
		).rejects.toMatchObject({
			code: "not_found",
		});
		expect(db.fts.get("m1")).toContain("into");
		expect(db.fts.get("m2")).toContain("into");
		db.blockMerge = true;
		db.tags.set("c", {
			id: "c",
			name: "other",
			display_name: "other",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		await expect(
			commitTagWrite(asD1(db), repo.merge("other", "into", "key:1")),
		).rejects.toMatchObject({
			code: "unprocessable",
		});
	});

	it("rejects broken and cyclic redirects", async () => {
		const db = new FakeD1();
		db.tags.set("c1", {
			id: "c1",
			name: "loop",
			display_name: "loop",
			merged_into: "c2",
			created_at: 1,
			updated_at: 1,
		});
		db.tags.set("c2", {
			id: "c2",
			name: "loop2",
			display_name: "loop2",
			merged_into: "c1",
			created_at: 1,
			updated_at: 1,
		});
		const repo = new TagRepo(asD1(db));
		await expect(repo.follow(db.tags.get("c1") as never)).rejects.toMatchObject({
			code: "unprocessable",
		});
		db.tags.set("b1", {
			id: "b1",
			name: "broken",
			display_name: "broken",
			merged_into: "missing",
			created_at: 1,
			updated_at: 1,
		});
		await expect(repo.follow(db.tags.get("b1") as never)).rejects.toMatchObject({
			code: "unprocessable",
		});
	});

	it("rethrows unexpected rename and merge failures", async () => {
		const db = new FakeD1();
		db.tags.set("a", {
			id: "a",
			name: "old",
			display_name: "old",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		db.tags.set("b", {
			id: "b",
			name: "into",
			display_name: "into",
			merged_into: null,
			created_at: 1,
			updated_at: 1,
		});
		const boom = asD1(db);
		boom.batch = async () => {
			throw new Error("boom");
		};
		await expect(
			commitTagWrite(boom, new TagRepo(boom, () => 1).rename("old", "new", "key:1")),
		).rejects.toThrow("boom");
		await expect(
			commitTagWrite(boom, new TagRepo(boom, () => 1).merge("old", "into", "key:1")),
		).rejects.toThrow("boom");
	});

	it("throws when insert does not become readable", async () => {
		const db = {
			prepare() {
				return {
					bind: () => ({
						run: async () => ({ success: true }),
						first: async () => null,
					}),
				};
			},
		} as unknown as D1Database;
		await expect(new TagRepo(db).resolveMany(["x"])).rejects.toMatchObject({ code: "internal" });
	});
});
