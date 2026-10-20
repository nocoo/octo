import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	spaceManagementCreateSchema,
	spaceManagementPatchSchema,
} from "../../lib/schema/space-management";
import type { ApiPrincipal } from "../auth/authorize";
import { migratedSqlite } from "../repo/__tests__/sqlite-d1";
import {
	createManagedSpace,
	deleteManagedSpace,
	mapSpaceWriteError,
	requireSpaceAdmin,
	updateManagedSpace,
} from "./space-management";

const admin: ApiPrincipal = {
	id: "admin-key",
	name: "Admin",
	role: "admin",
	ops: new Set(),
	scope: "spaces",
	spaceIds: [],
	ownedSpaceIds: [],
	ownEntriesOnly: true,
	autoOwnSpace: false,
	expiresAt: null,
};

describe("space management service", () => {
	let store: ReturnType<typeof migratedSqlite>;
	beforeEach(() => {
		store = migratedSqlite();
		store.raw.exec("PRAGMA foreign_keys = ON");
	});
	afterEach(() => store.raw.close());
	const input = { slug: "knowledge", name: "Knowledge", description: "Keep this description" };
	const create = () => createManagedSpace(store.d1, admin, input);
	const changeCount = () => store.raw.prepare("SELECT COUNT(*) AS n FROM changes").get()?.n;
	function insertMemory(spaceId: string) {
		store.raw
			.prepare(
				"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('m', ?, 'T', 'B', 'note', 'key', 'hash', 1, 1)",
			)
			.run(spaceId);
	}

	it("does not inherit creation defaults in patches", async () => {
		expect(spaceManagementCreateSchema.parse({ slug: "s", name: " S " })).toEqual({
			slug: "s",
			name: "S",
			description: "",
		});
		expect(spaceManagementPatchSchema.safeParse({}).success).toBe(false);
		expect(spaceManagementPatchSchema.safeParse({ description: undefined }).success).toBe(false);
		expect(spaceManagementPatchSchema.parse({ name: " New " })).toEqual({ name: "New" });
		const row = await create();
		await expect(updateManagedSpace(store.d1, admin, String(row.slug), {})).rejects.toMatchObject({
			code: "validation_failed",
		});
		const renamed = await updateManagedSpace(store.d1, admin, String(row.slug), { name: "New" });
		expect(renamed).toMatchObject({
			id: String(row.id),
			slug: String(row.slug),
			name: "New",
			description: input.description,
		});
		expect(changeCount()).toBe(2);
	});

	it("checks exact admin role independently of key permission templates", async () => {
		for (const role of ["project", "custom", "readonly", "drop", "ADMIN", ""]) {
			const principal = { ...admin, role };
			expect(() => requireSpaceAdmin(principal)).toThrow(
				expect.objectContaining({ code: "forbidden" }),
			);
			await expect(createManagedSpace(store.d1, principal, input)).rejects.toMatchObject({
				code: "forbidden",
			});
			await expect(updateManagedSpace(store.d1, principal, "missing", {})).rejects.toMatchObject({
				code: "forbidden",
			});
			await expect(deleteManagedSpace(store.d1, principal, "missing")).rejects.toMatchObject({
				code: "forbidden",
			});
		}
		const row = await create();
		expect(row).toMatchObject({
			owner_key_id: null,
			memory_count: 0,
			created_at: expect.stringMatching(/Z$/),
		});
		expect(store.raw.prepare("SELECT actor FROM changes").all()).toEqual([
			{ actor: "key:admin-key" },
		]);
	});

	it("validates schema bounds and rejects owner mutations", () => {
		for (const body of [
			{ owner_key_id: null },
			{ extra: true },
			{ name: " " },
			{ name: "a".repeat(257) },
			{ description: "a".repeat(10001) },
			{ description: null },
		]) {
			expect(spaceManagementPatchSchema.safeParse(body).success).toBe(false);
		}
		for (const body of [
			{ slug: "" },
			{ slug: "Bad" },
			{ slug: "a".repeat(65) },
			{ owner_key_id: "key" },
			{ extra: true },
			{ name: "" },
			{ name: "a".repeat(257) },
			{ description: "a".repeat(10001) },
		]) {
			expect(spaceManagementCreateSchema.safeParse({ ...input, ...body }).success).toBe(false);
		}
		expect(
			spaceManagementCreateSchema.safeParse({
				slug: "a".repeat(64),
				name: "a".repeat(256),
				description: "a".repeat(10000),
			}).success,
		).toBe(true);
		expect(spaceManagementPatchSchema.parse({ description: "" })).toEqual({ description: "" });
	});

	it("returns conflicts and missing resources without writing extra changes", async () => {
		await create();
		await expect(create()).rejects.toMatchObject({ code: "version_conflict" });
		await expect(
			updateManagedSpace(store.d1, admin, "missing", { name: "New" }),
		).rejects.toMatchObject({ code: "not_found" });
		await expect(deleteManagedSpace(store.d1, admin, "missing")).rejects.toMatchObject({
			code: "not_found",
		});
		expect(changeCount()).toBe(1);
	});

	it("keeps description-only and unchanged writes on the existing admin update path", async () => {
		const row = await create();
		insertMemory(String(row.id));
		const updated = await updateManagedSpace(store.d1, admin, String(row.slug), {
			description: "",
		});
		expect(updated).toMatchObject({ name: input.name, description: "", memory_count: 1 });
		await updateManagedSpace(store.d1, admin, String(row.slug), { description: "" });
		expect(changeCount()).toBe(3);
		await expect(deleteManagedSpace(store.d1, admin, String(row.slug))).rejects.toMatchObject({
			code: "space_not_empty",
		});
	});

	it("stages writes without committing before the HTTP transaction", async () => {
		const statements: D1PreparedStatement[] = [];
		const row = await createManagedSpace(store.d1, admin, input, statements);
		expect(changeCount()).toBe(0);
		expect(store.raw.prepare("SELECT * FROM spaces").all()).toEqual([]);
		await store.d1.batch(statements);
		const updated: D1PreparedStatement[] = [];
		await updateManagedSpace(store.d1, admin, String(row.slug), { name: "Staged" }, updated);
		expect(store.raw.prepare("SELECT name FROM spaces").get()?.name).toBe(input.name);
		await store.d1.batch(updated);
		expect(store.raw.prepare("SELECT name FROM spaces").get()?.name).toBe("Staged");
		const removed: D1PreparedStatement[] = [];
		await deleteManagedSpace(store.d1, admin, String(row.slug), removed);
		expect(changeCount()).toBe(2);
		await store.d1.batch(removed);
		expect(store.raw.prepare("SELECT * FROM spaces").all()).toEqual([]);
		expect(changeCount()).toBe(3);
	});

	it("aborts stale staged updates and deletes before their change events", async () => {
		await create();
		for (const operation of ["update", "delete"]) {
			const statements: D1PreparedStatement[] = [];
			if (operation === "update")
				await updateManagedSpace(store.d1, admin, input.slug, { name: "Stale" }, statements);
			else await deleteManagedSpace(store.d1, admin, input.slug, statements);
			store.raw.exec("UPDATE spaces SET name = 'Winner', updated_at = updated_at + 1");
			await expect(
				store.d1.batch(statements).catch((error) => {
					throw mapSpaceWriteError(error) ?? error;
				}),
			).rejects.toMatchObject({ code: "version_conflict" });
		}
		expect(changeCount()).toBe(1);
		expect(store.raw.prepare("SELECT name FROM spaces").get()?.name).toBe("Winner");
	});

	it("rechecks emptiness inside the staged delete batch", async () => {
		const row = await create();
		const statements: D1PreparedStatement[] = [];
		await deleteManagedSpace(store.d1, admin, String(row.slug), statements);
		insertMemory(String(row.id));
		await expect(
			store.d1.batch(statements).catch((error) => {
				throw mapSpaceWriteError(error) ?? error;
			}),
		).rejects.toMatchObject({ code: "space_not_empty" });
		expect(changeCount()).toBe(1);
		expect(store.raw.prepare("SELECT id FROM spaces").get()?.id).toBe(String(row.id));
	});

	it("maps duplicate-slug races and leaves unknown storage failures untouched", async () => {
		const statements: D1PreparedStatement[] = [];
		await createManagedSpace(store.d1, admin, input, statements);
		await create();
		await expect(
			store.d1.batch(statements).catch((error) => {
				throw mapSpaceWriteError(error) ?? error;
			}),
		).rejects.toMatchObject({ code: "version_conflict" });
		expect(mapSpaceWriteError(new Error("storage unavailable"))).toBeUndefined();
		expect(changeCount()).toBe(1);
	});

	it("rolls back a direct service mutation when the change event cannot be written", async () => {
		store.raw.exec(
			"CREATE TRIGGER reject_changes BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'change unavailable'); END",
		);
		await expect(create()).rejects.toMatchObject({
			code: "unavailable",
			message: "write transaction failed",
		});
		expect(store.raw.prepare("SELECT * FROM spaces").all()).toEqual([]);
	});
});
