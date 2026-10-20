import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spaceManagementPatchSchema } from "../../lib/schema/space-management";
import { migratedSqlite } from "../repo/__tests__/sqlite-d1";
import { MemoryRepo } from "../repo/memories";
import { ensureAutoOwnSpace, prepareOwnSpace, SpaceRepo } from "../repo/spaces";
import { createSpace, deleteSpace, mapSpaceWriteError, updateSpace } from "./space-management";

describe("space slug aliases", () => {
	let store: ReturnType<typeof migratedSqlite>;
	beforeEach(() => {
		store = migratedSqlite();
		store.raw.exec("PRAGMA foreign_keys = ON");
	});
	afterEach(() => store.raw.close());
	const create = (slug = "original") =>
		createSpace(store.d1, { slug, name: "Name", description: "Description" }, "admin");
	const lookup = (slug: string) => new SpaceRepo(store.d1).getVisibleBySlug(slug, { kind: "all" });

	it("validates optional slug patches without creation defaults", () => {
		expect(spaceManagementPatchSchema.parse({ slug: "new-slug" })).toEqual({ slug: "new-slug" });
		for (const slug of ["", "Upper", "two--words", "-start", "end-", "a".repeat(65)]) {
			const parsed = spaceManagementPatchSchema.safeParse({ slug });
			expect(parsed.success).toBe(false);
			if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["slug"]);
		}
	});

	it("resolves aliases to the same id and canonical slug for 30 days", async () => {
		const original = await create();
		const updated = await updateSpace(store.d1, original, { slug: "renamed" }, "admin");
		expect(updated).toMatchObject({ id: original.id, name: "Name", description: "Description" });
		expect(await lookup("original")).toMatchObject({ id: original.id, slug: "renamed" });
		expect(await new MemoryRepo(store.d1).spaceBySlug("original")).toMatchObject({
			id: original.id,
			slug: "renamed",
		});
		expect(
			await new SpaceRepo(store.d1).getVisibleBySlug("original", { kind: "ids", ids: [] }),
		).toBeNull();
		expect(store.raw.prepare("SELECT * FROM space_slug_aliases").get()).toMatchObject({
			slug: "original",
			space_id: original.id,
			created_at: updated.updated_at,
			expires_at: updated.updated_at + 30 * 24 * 60 * 60 * 1000,
		});
	});

	it("allows renaming back and drops all aliases when the space is deleted", async () => {
		const original = await create();
		const second = await updateSpace(store.d1, original, { slug: "second" }, "admin");
		const third = await updateSpace(store.d1, second, { slug: "third" }, "admin");
		const back = await updateSpace(store.d1, third, { slug: "original" }, "admin");
		for (const slug of ["original", "second", "third"]) {
			expect(await lookup(slug)).toMatchObject({ id: original.id, slug: "original" });
		}
		expect(store.raw.prepare("SELECT slug FROM space_slug_aliases ORDER BY slug").all()).toEqual([
			{ slug: "second" },
			{ slug: "third" },
		]);
		await deleteSpace(store.d1, back, "admin");
		expect(store.raw.prepare("SELECT * FROM space_slug_aliases").all()).toEqual([]);
	});

	it("reports canonical and alias conflicts on the slug field", async () => {
		const original = await create();
		const renamed = await updateSpace(store.d1, original, { slug: "renamed" }, "admin");
		const other = await create("other");
		for (const slug of [original.slug, renamed.slug]) {
			const conflict = { status: 409, details: { issues: [{ path: "slug" }] } };
			await expect(create(slug)).rejects.toMatchObject(conflict);
			await expect(updateSpace(store.d1, other, { slug }, "admin")).rejects.toMatchObject(conflict);
		}
	});

	it("ignores expired aliases and allows their reuse", async () => {
		const original = await create();
		await updateSpace(store.d1, original, { slug: "renamed" }, "admin");
		store.raw.exec("UPDATE space_slug_aliases SET expires_at = 0");
		expect(await lookup("original")).toBeNull();
		const reused = await create("original");
		expect(reused.id).not.toBe(original.id);
		expect(await lookup("original")).toMatchObject({ id: reused.id });
	});

	it("guards live aliases inside staged transactions", async () => {
		const original = await create();
		const other = await create("other");
		const staged: D1PreparedStatement[] = [];
		await updateSpace(store.d1, other, { slug: "available" }, "admin", staged);
		const occupied = await updateSpace(store.d1, original, { slug: "available" }, "admin");
		await updateSpace(store.d1, occupied, { slug: "final" }, "admin");
		await expect(
			store.d1.batch(staged).catch((error) => {
				throw mapSpaceWriteError(error) ?? error;
			}),
		).rejects.toMatchObject({ status: 409, details: { issues: [{ path: "slug" }] } });
		expect(await lookup("other")).toMatchObject({ id: other.id, slug: "other" });
	});

	it("does not auto-create an own space over a live alias", async () => {
		const original = await create();
		await updateSpace(store.d1, original, { slug: "renamed" }, "admin");
		const key = { id: "other-key", name: "original", auto_own_space: 1 };
		await expect(prepareOwnSpace(store.d1, key, Date.now, () => "owned")).rejects.toMatchObject({
			code: "unprocessable",
		});
		await expect(ensureAutoOwnSpace(store.d1, key)).rejects.toMatchObject({
			code: "unprocessable",
		});
	});
});
