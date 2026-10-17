import { describe, expect, it } from "vitest";
import {
	type BatchResponse,
	batchFixture,
	memoryInput,
} from "../../../../../../tests/fixtures/batch-app";
import { testApiPrincipal } from "../../test-principal";

describe("batch authorization", () => {
	it.each(["Create", "Update", "Delete"])("denies %s for readonly keys", async (action) => {
		const f = batchFixture(undefined, { ...testApiPrincipal(), ops: new Set(["r"]) });
		const ctx = f.ctx();
		const row = await f.service.create(memoryInput, ctx);
		await f.db.batch(ctx.statements);
		const payload =
			action === "Create"
				? { items: [memoryInput] }
				: action === "Update"
					? { items: [{ id: row.id, title: "new", expected_version: 1 }] }
					: { ids: [row.id] };
		const body = (await (await f.post(action, payload)).json()) as BatchResponse;
		expect(body.results[0]).toMatchObject({ ok: false, error: { code: "forbidden" } });
		expect(await f.service.get(row.id, f.ctx())).toEqual(row);
		f.sqlite.close();
	});
	it("hides invisible records and denies cross-space moves", async () => {
		const f = batchFixture(undefined, {
			...testApiPrincipal(),
			scope: "spaces",
			spaceIds: ["space:kb"],
		});
		const ctx = f.ctx();
		const own = await f.service.create(memoryInput, ctx);
		const hidden = await f.service.create({ ...memoryInput, space: "other" }, ctx);
		await f.db.batch(ctx.statements);
		for (const action of ["Update", "Delete"]) {
			const payload =
				action === "Update"
					? { items: [own, hidden].map((r) => ({ id: r.id, space: "other", expected_version: 1 })) }
					: { ids: [hidden.id] };
			const body = (await (await f.post(action, payload)).json()) as BatchResponse;
			expect(body.results.every((r) => !r.ok && r.error?.code === "not_found")).toBe(true);
		}
		const create = (await (
			await f.post("Create", { items: [{ ...memoryInput, space: "other" }] })
		).json()) as BatchResponse;
		expect(create.results[0]).toMatchObject({ ok: false, error: { code: "not_found" } });
		f.sqlite.close();
	});
});
