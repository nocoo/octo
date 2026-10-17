import { describe, expect, it } from "vitest";
import { StubMemoryService } from "./stub-memories";

describe("StubMemoryService", () => {
	it("creates updates and deletes memories", async () => {
		const svc = new StubMemoryService();
		const ctx = { keyId: "kid", actor: "key:kid" };
		const created = await svc.create(
			{ space: "s", title: "t", body: "b", type: "note", tags: [] },
			ctx,
		);
		const updated = await svc.update(created.id, { title: "new", expected_version: 1 }, ctx);
		expect(updated.version).toBe(2);
		const trashed = await svc.delete(created.id, ctx);
		expect(trashed.trashed_at).toBeTruthy();
	});

	it("returns not_found for missing memories", async () => {
		const svc = new StubMemoryService();
		const ctx = { keyId: "kid", actor: "key:kid" };
		await expect(
			svc.update("missing", { title: "x", expected_version: 1 }, ctx),
		).rejects.toMatchObject({
			code: "not_found",
		});
		await expect(svc.delete("missing", ctx)).rejects.toMatchObject({ code: "not_found" });
	});

	it("returns version_conflict on stale updates", async () => {
		const svc = new StubMemoryService();
		const ctx = { keyId: "kid", actor: "key:kid" };
		const created = await svc.create(
			{ space: "s", title: "t", body: "b", type: "note", tags: [] },
			ctx,
		);
		await expect(
			svc.update(created.id, { title: "x", expected_version: 99 }, ctx),
		).rejects.toMatchObject({ code: "version_conflict" });
	});
});
