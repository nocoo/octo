import { describe, expect, it } from "vitest";
import { asD1, FakeD1 } from "./__tests__/fake-d1";
import { ensureAutoOwnSpace, SpaceRepo } from "./spaces";

describe("SpaceRepo", () => {
	it("lists only visible spaces with live memory counts", async () => {
		const db = new FakeD1();
		db.spaces.set("s1", {
			id: "s1",
			slug: "kb-bot",
			name: "kb",
			description: "",
			owner_key_id: "k1",
			created_at: 1,
			updated_at: 1,
		});
		db.spaces.set("s2", {
			id: "s2",
			slug: "hidden",
			name: "hidden",
			description: "",
			owner_key_id: null,
			created_at: 1,
			updated_at: 1,
		});
		db.memories.set("m1", { id: "m1", space_id: "s1", deleted_at: null });
		db.memories.set("m2", { id: "m2", space_id: "s1", deleted_at: 4 });
		const repo = new SpaceRepo(asD1(db));
		expect(await repo.listVisible([])).toEqual([]);
		const listed = await repo.listVisible(["s1"]);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.memory_count).toBe(1);
		expect(await repo.getVisibleBySlug("hidden", ["s1"])).toBeNull();
		expect(await repo.getVisibleBySlug("missing", ["s1"])).toBeNull();
		expect((await repo.getVisibleBySlug("kb-bot", ["s1"]))?.memory_count).toBe(1);
		expect((await repo.listVisible(["s2"]))[0]?.memory_count).toBe(0);
		const noCount = new FakeD1();
		noCount.spaces.set("s1", db.spaces.get("s1") as never);
		noCount.exec = (sql: string, binds: unknown[]) => {
			if (sql.includes("COUNT(*)")) {
				return [];
			}
			return FakeD1.prototype.exec.call(noCount, sql, binds);
		};
		expect(
			(await new SpaceRepo(asD1(noCount)).getVisibleBySlug("kb-bot", ["s1"]))?.memory_count,
		).toBe(0);
	});
});

describe("ensureAutoOwnSpace", () => {
	it("returns null when the flag is off", async () => {
		expect(
			await ensureAutoOwnSpace(asD1(new FakeD1()), {
				id: "k",
				name: "kb-bot",
				auto_own_space: 0,
			}),
		).toBeNull();
	});

	it("reuses an owned space or creates slug=key name", async () => {
		const db = new FakeD1();
		const created = await ensureAutoOwnSpace(
			asD1(db),
			{ id: "k1", name: "kb-bot", auto_own_space: 1 },
			() => 8,
			() => "sid",
		);
		expect(created?.slug).toBe("kb-bot");
		expect(created?.owner_key_id).toBe("k1");
		const again = await ensureAutoOwnSpace(asD1(db), {
			id: "k1",
			name: "kb-bot",
			auto_own_space: 1,
		});
		expect(again?.id).toBe("sid");
	});

	it("rejects a slug owned by someone else", async () => {
		const db = new FakeD1();
		db.spaces.set("s", {
			id: "s",
			slug: "kb-bot",
			name: "kb-bot",
			description: "",
			owner_key_id: "other",
			created_at: 1,
			updated_at: 1,
		});
		await expect(
			ensureAutoOwnSpace(asD1(db), { id: "k1", name: "kb-bot", auto_own_space: 1 }),
		).rejects.toMatchObject({ code: "unprocessable" });
	});
});
