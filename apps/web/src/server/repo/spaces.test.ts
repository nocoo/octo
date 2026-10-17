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
		expect(await repo.listVisible({ kind: "ids", ids: [] })).toEqual([]);
		const listed = await repo.listVisible({ kind: "ids", ids: ["s1"] });
		expect(listed).toHaveLength(1);
		expect(listed[0]?.memory_count).toBe(1);
		expect(await repo.getVisibleBySlug("hidden", { kind: "ids", ids: ["s1"] })).toBeNull();
		expect(await repo.getVisibleBySlug("missing", { kind: "ids", ids: ["s1"] })).toBeNull();
		expect(
			(await repo.getVisibleBySlug("kb-bot", { kind: "ids", ids: ["s1"] }))?.memory_count,
		).toBe(1);
		expect((await repo.listVisible({ kind: "ids", ids: ["s2"] }))[0]?.memory_count).toBe(0);
		const many = new FakeD1();
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
		expect((await new SpaceRepo(asD1(many)).listVisible({ kind: "all" })).length).toBe(101);
		expect((await new SpaceRepo(asD1(many)).listVisible({ kind: "ids", ids })).length).toBe(101);
		const dupDb = new FakeD1();
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
		const spanning = ["dup", ...Array.from({ length: 99 }, (_, i) => `other${i}`), "dup"];
		const listedDup = await new SpaceRepo(asD1(dupDb)).listVisible({
			kind: "ids",
			ids: spanning,
		});
		expect(listedDup).toHaveLength(100);
		expect(listedDup.filter((s) => s.id === "dup")).toHaveLength(1);
		expect(listedDup.find((s) => s.id === "dup")?.memory_count).toBe(1);
		const noCount = new FakeD1();
		noCount.spaces.set("s1", db.spaces.get("s1") as never);
		noCount.exec = (sql: string, binds: unknown[]) => {
			if (sql.includes("COUNT(*)")) {
				return [];
			}
			return FakeD1.prototype.exec.call(noCount, sql, binds);
		};
		expect(
			(
				await new SpaceRepo(asD1(noCount)).getVisibleBySlug("kb-bot", {
					kind: "ids",
					ids: ["s1"],
				})
			)?.memory_count,
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

	it("returns the space created by a concurrent insert of the same key", async () => {
		const db = new FakeD1();
		db.spaces.set("s", {
			id: "s",
			slug: "kb-bot",
			name: "kb-bot",
			description: "",
			owner_key_id: "k1",
			created_at: 1,
			updated_at: 1,
		});
		const row = await ensureAutoOwnSpace(asD1(db), {
			id: "k1",
			name: "kb-bot",
			auto_own_space: 1,
		});
		expect(row?.id).toBe("s");
	});

	it("fails closed if the slug row cannot be read", async () => {
		const db = new FakeD1();
		db.hideSlug = true;
		await expect(
			ensureAutoOwnSpace(asD1(db), { id: "k1", name: "kb-bot", auto_own_space: 1 }),
		).rejects.toMatchObject({ code: "internal" });
	});
});
