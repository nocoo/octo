import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { asD1, FakeD1 } from "./__tests__/fake-d1";
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
		expect(normalizeTag("x".repeat(64))).toBe("x".repeat(64));
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
		expect(await repo.listWithCounts([])).toEqual([
			{ id: "t1", name: "infra", display_name: "infra", use_count: 0 },
		]);
		expect(await repo.listWithCounts(["s1"])).toEqual([
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
		await expect(repo.rename("missing", "n", "key:1")).rejects.toBeInstanceOf(ApiError);
		try {
			await repo.rename("old", "taken", "key:1");
			throw new Error("expected conflict");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			expect((err as ApiError).code).toBe("tag_conflict");
			expect((err as ApiError).details).toEqual({ suggest: "merge", into: "taken" });
		}
		const renamed = await repo.rename("old", "New", "key:1");
		expect(renamed.name).toBe("new");
		expect(renamed.display_name).toBe("New");
		expect(db.changes).toHaveLength(1);
		const same = await repo.rename("new", "NEW", "key:1");
		expect(same.id).toBe("a");
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
		const result = await repo.merge("from", "into", "key:1");
		expect(result.memories).toBe(2);
		expect(db.tags.get("a")?.merged_into).toBe("b");
		expect(db.memoryTags).toEqual([
			{ memory_id: "m1", tag_id: "b" },
			{ memory_id: "m2", tag_id: "b" },
		]);
		expect(db.changes).toHaveLength(2);
		await expect(repo.merge("into", "into", "key:1")).rejects.toMatchObject({
			code: "validation_failed",
		});
		await expect(repo.merge("missing", "into", "key:1")).rejects.toMatchObject({
			code: "not_found",
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
