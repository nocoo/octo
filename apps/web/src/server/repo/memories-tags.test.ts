import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { insertSpace, openTestD1 } from "./__tests__/sqlite-d1";
import { InlineTagRepo, normalizeTag, tagDisplayName } from "./memories-tags";

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
		expect(() => tagDisplayName("  ")).toThrow(ApiError);
		expect(() => tagDisplayName("y".repeat(65))).toThrow(ApiError);
	});
});

describe("InlineTagRepo", () => {
	it("creates or gets tags, dedupes, and follows merged_into", async () => {
		const db = openTestD1();
		const repo = new InlineTagRepo(
			db,
			() => 10,
			() => "id1",
		);
		const [created] = await repo.resolveMany(["Infra"]);
		expect(created?.name).toBe("infra");
		expect(created?.display_name).toBe("Infra");
		const repo2 = new InlineTagRepo(
			db,
			() => 11,
			() => "id2",
		);
		const [again, dup] = await repo2.resolveMany(["INFRA", "infra"]);
		expect(again?.id).toBe(created?.id);
		expect(dup).toBeUndefined();
		await db
			.prepare(
				"INSERT INTO tags (id, name, display_name, merged_into, created_at, updated_at) VALUES ('alias', 'old', 'old', ?, 1, 1)",
			)
			.bind(created?.id ?? "")
			.run();
		const [redirected] = await repo2.resolveMany(["old"]);
		expect(redirected?.id).toBe(created?.id);
		expect(await repo2.lookupMany(["missing", "old"])).toEqual([redirected]);
		expect(await repo2.lookupMany(["old", "OLD"])).toEqual([redirected]);
	});

	it("rejects merge cycles and broken redirects", async () => {
		const db = openTestD1();
		await db
			.prepare(
				"INSERT INTO tags (id, name, display_name, merged_into, created_at, updated_at) VALUES ('a', 'a', 'a', NULL, 1, 1), ('b', 'b', 'b', NULL, 1, 1)",
			)
			.run();
		await db.prepare("UPDATE tags SET merged_into = 'b' WHERE id = 'a'").run();
		await db.prepare("UPDATE tags SET merged_into = 'a' WHERE id = 'b'").run();
		const repo = new InlineTagRepo(db);
		await expect(repo.resolveMany(["a"])).rejects.toMatchObject({ code: "unprocessable" });
		await expect(
			repo.follow({ id: "c", name: "c", display_name: "c", merged_into: "gone" }),
		).rejects.toMatchObject({ code: "unprocessable" });
	});
});

describe("insertSpace helper", () => {
	it("inserts a space row", async () => {
		const db = openTestD1();
		await insertSpace(db, { id: "s1", slug: "kb-bot", ownerKeyId: "k1" });
		const row = await db
			.prepare("SELECT slug, owner_key_id FROM spaces WHERE id = ?")
			.bind("s1")
			.first<{ slug: string; owner_key_id: string }>();
		expect(row).toEqual({ slug: "kb-bot", owner_key_id: "k1" });
	});
});
