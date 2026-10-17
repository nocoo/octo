import { describe, expect, it, vi } from "vitest";
import {
	type BatchResponse,
	batchFixture,
	memoryInput,
} from "../../../../../../tests/fixtures/batch-app";
import { TestMemoryService } from "../../../../../../tests/fixtures/memories";
import { ApiError } from "../../lib/errors";

describe("batch item isolation", () => {
	it("reports an unresolved space per item and still creates the next item", async () => {
		const f = batchFixture();
		const response = await f.post("Create", {
			items: [{ ...memoryInput, space: "missing" }, memoryInput],
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as BatchResponse;
		expect(body.results[0]).toMatchObject({ ok: false, error: { code: "not_found" } });
		expect(body.results[1]?.ok).toBe(true);
		expect(f.sqlite.prepare("SELECT * FROM _m6_memories").all()).toHaveLength(1);
		f.sqlite.close();
	});
	it("atomically stores and replays a legitimate multi-megabyte batch", async () => {
		const f = batchFixture();
		const items = Array.from({ length: 3 }, () => ({ ...memoryInput, body: "x".repeat(800_000) }));
		const headers = { "Idempotency-Key": "large" };
		const first = await f.post("Create", { items }, headers);
		expect(first.status).toBe(200);
		const original = await first.text();
		expect((JSON.parse(original) as BatchResponse).results.every((r) => r.ok)).toBe(true);
		const replay = await f.post("Create", { items }, headers);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(original);
		expect(f.sqlite.prepare("SELECT * FROM _m6_memories").all()).toHaveLength(3);
		f.sqlite.close();
	});
	it.each(["Create", "Update", "Delete"])("rejects oversized %s batches", async (action) => {
		const f = batchFixture();
		const items = Array.from({ length: 101 }, () =>
			action === "Create" ? memoryInput : { id: "missing", title: "t", expected_version: 1 },
		);
		expect(
			(await f.post(action, action === "Delete" ? { ids: Array(101).fill("id") } : { items }))
				.status,
		).toBe(413);
		expect((await f.post(action, { unknown: true })).status).toBe(400);
		f.sqlite.close();
	});
	it("returns details and discards SQL staged by a failing item", async () => {
		const svc = new TestMemoryService();
		const f = batchFixture(svc);
		vi.spyOn(svc, "create").mockImplementationOnce(async (_input, ctx) => {
			ctx.statements.push(ctx.db.prepare("INSERT INTO _m6_memories VALUES ('bad', '{}', NULL)"));
			throw new ApiError("validation_failed", "invalid", { issues: [] });
		});
		const body = (await (
			await f.post("Create", { items: [memoryInput, memoryInput] })
		).json()) as BatchResponse;
		expect(body.results[0]).toMatchObject({
			ok: false,
			error: { code: "validation_failed", details: { issues: [] } },
		});
		expect(body.results[1]?.ok).toBe(true);
		expect(f.sqlite.prepare("SELECT * FROM _m6_memories").all()).toHaveLength(1);
		f.sqlite.close();
	});
	it("returns per-item not_found, version_conflict and successful state changes", async () => {
		const f = batchFixture();
		const created = (await (
			await f.post("Create", { items: [memoryInput] })
		).json()) as BatchResponse;
		const id = created.results[0]?.item?.id;
		const updated = (await (
			await f.post("Update", {
				items: [
					{ id, title: "changed", expected_version: 1 },
					{ id, title: "stale", expected_version: 1 },
					{ id: "missing", title: "x", expected_version: 1 },
				],
			})
		).json()) as BatchResponse;
		expect(updated.results[0]).toMatchObject({ ok: true, item: { title: "changed", version: 2 } });
		expect(updated.results[1]).toMatchObject({ ok: false, error: { code: "version_conflict" } });
		expect(updated.results[2]).toMatchObject({ ok: false, error: { code: "not_found" } });
		const deleted = (await (
			await f.post("Delete", { ids: [id, id, "missing"] })
		).json()) as BatchResponse;
		expect(deleted.results[0]?.ok).toBe(true);
		expect(deleted.results.slice(1).map((r) => r.error?.code)).toEqual(["not_found", "not_found"]);
		f.sqlite.close();
	});
});
