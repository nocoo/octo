import { describe, expect, it, vi } from "vitest";
import {
	type BatchResponse,
	batchFixture,
	memoryInput,
} from "../../../../../../tests/fixtures/batch-app";
import { TestMemoryService } from "../../../../../../tests/fixtures/memories";
import { testApiPrincipal } from "../../test-principal";

describe("batch authorization regression", () => {
	it.each(["spaces", "own"] as const)(
		"resolves ids and enforces creator ownership with %s scope",
		async (scope) => {
			const principal = {
				...testApiPrincipal(),
				scope,
				spaceIds: ["space:kb", "space:dest"],
				ownedSpaceIds: ["space:kb", "space:dest"],
				ownEntriesOnly: true,
			};
			const f = batchFixture(undefined, principal);
			const created = (await (
				await f.post("Create", { items: [memoryInput] })
			).json()) as BatchResponse;
			expect(created.results[0]?.ok).toBe(true);
			const ownId = created.results[0]?.item?.id;
			const ctx = f.ctx("other");
			const other = await f.service.create(memoryInput, ctx);
			await f.db.batch(ctx.statements);
			const updated = (await (
				await f.post("Update", {
					items: [ownId, other.id].map((id) => ({ id, space: "dest", expected_version: 1 })),
				})
			).json()) as BatchResponse;
			expect(updated.results.map((r) => r.ok)).toEqual([true, false]);
			expect(updated.results[1]?.error?.code).toBe("forbidden");
			const deleted = (await (
				await f.post("Delete", { ids: [ownId, other.id] })
			).json()) as BatchResponse;
			expect(deleted.results.map((r) => r.ok)).toEqual([true, false]);
			expect(deleted.results[1]?.error?.code).toBe("forbidden");
			f.sqlite.close();
		},
	);
	it.each(["Update", "Delete"])("continues %s after an item lookup throws", async (action) => {
		const svc = new TestMemoryService();
		const f = batchFixture(svc);
		const ctx = f.ctx();
		const rows = await Promise.all([1, 2, 3].map(() => svc.create(memoryInput, ctx)));
		await f.db.batch(ctx.statements);
		const get = svc.get.bind(svc);
		vi.spyOn(svc, "get").mockImplementation((id, c) => {
			if (id === rows[1]?.id) throw new Error("lookup failed");
			return get(id, c);
		});
		const response = await f.post(
			action,
			action === "Delete"
				? { ids: rows.map((r) => r.id) }
				: { items: rows.map((r) => ({ id: r.id, title: "updated", expected_version: 1 })) },
		);
		expect(response.status).toBe(200);
		const result = (await response.json()) as BatchResponse;
		expect(result.results.map((r) => r.ok)).toEqual([true, false, true]);
		expect(result.results[1]?.error?.code).toBe("internal");
		const persisted = await Promise.all(rows.map((r) => get(r.id, f.ctx())));
		expect(
			persisted.map((r) => (action === "Delete" ? r === null : r?.title === "updated")),
		).toEqual([true, false, true]);
		f.sqlite.close();
	});
});
