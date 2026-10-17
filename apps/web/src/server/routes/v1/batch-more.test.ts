import { describe, expect, it, vi } from "vitest";
import {
	type BatchResponse,
	batchFixture,
	memoryInput,
} from "../../../../../../tests/fixtures/batch-app";
import { ApiError } from "../../lib/errors";
import { BatchMemoryService } from "../../services/batch-memories";

describe("batch item isolation", () => {
	it("rolls back predicted memory, tags and SQL when an item fails after staging", async () => {
		const svc = new BatchMemoryService();
		const scenario = batchFixture(svc);
		const created = (await (
			await scenario.post("Create", { items: [memoryInput] })
		).json()) as BatchResponse;
		const id = created.results[0]?.item?.id;
		const update = svc.update.bind(svc);
		vi.spyOn(svc, "update").mockImplementationOnce(async (...args) => {
			await update(...args);
			throw new Error("failed after staging");
		});
		const response = await scenario.post("Update", {
			items: [
				{ id, title: "discarded", body: "discarded", tags: ["Discarded"], expected_version: 1 },
				{ id, title: "accepted", expected_version: 1 },
			],
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			results: [
				{ ok: false, error: { code: "internal" } },
				{ ok: true, item: { title: "accepted", body: "b", tags: [], version: 2 } },
			],
		});
		expect(scenario.sqlite.prepare("SELECT * FROM tags").all()).toEqual([]);
		expect(scenario.sqlite.prepare("SELECT title, body, version FROM memories").get()).toEqual({
			title: "accepted",
			body: "b",
			version: 2,
		});
		expect(
			scenario.sqlite.prepare("SELECT title FROM memory_versions ORDER BY version").all(),
		).toEqual([{ title: "t" }, { title: "accepted" }]);
		expect(scenario.sqlite.prepare("SELECT * FROM changes").all()).toHaveLength(2);
		scenario.sqlite.close();
	});

	it("forgets a failed tag resolution before another item creates that same tag", async () => {
		const scenario = batchFixture();
		const response = await scenario.post("Create", {
			items: [
				{ ...memoryInput, tags: ["RetryTag"], vector: { profile: "missing", values: [1] } },
				{ ...memoryInput, tags: ["RetryTag"] },
			],
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			results: [
				{ ok: false, error: { code: "validation_failed" } },
				{ ok: true, item: { tags: ["retrytag"] } },
			],
		});
		expect(scenario.sqlite.prepare("SELECT name FROM tags").all()).toEqual([{ name: "retrytag" }]);
		expect(scenario.sqlite.prepare("SELECT * FROM memory_tags").all()).toHaveLength(1);
		scenario.sqlite.close();
	});

	it("shares staged creates, updates and deletes without executing a private transaction", async () => {
		const scenario = batchFixture();
		const ctx = scenario.ctx();
		const first = await scenario.service.create({ ...memoryInput, tags: ["Shared"] }, ctx);
		const second = await scenario.service.create({ ...memoryInput, tags: ["SHARED"] }, ctx);
		await scenario.service.update(first.id, { title: "changed", expected_version: 1 }, ctx);
		await scenario.service.delete(first.id, ctx);
		expect(await scenario.service.get(first.id, ctx)).toBeNull();
		expect((await scenario.service.get(second.id, ctx))?.tags).toEqual(["shared"]);
		for (const table of [
			"memories",
			"memory_versions",
			"tags",
			"memory_tags",
			"memories_fts",
			"changes",
		])
			expect(scenario.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
		await scenario.db.batch(ctx.statements);
		expect(await scenario.service.get(first.id, scenario.ctx())).toBeNull();
		expect(
			scenario.sqlite
				.prepare("SELECT title, version, deleted_at FROM memories WHERE id = ?")
				.get(first.id),
		).toMatchObject({ title: "changed", version: 2, deleted_at: expect.any(Number) });
		expect(scenario.sqlite.prepare("SELECT name FROM tags").all()).toEqual([{ name: "shared" }]);
		expect(scenario.sqlite.prepare("SELECT * FROM memory_versions").all()).toHaveLength(3);
		expect(scenario.sqlite.prepare("SELECT * FROM memories_fts").all()).toHaveLength(1);
		expect(scenario.sqlite.prepare("SELECT * FROM changes").all()).toHaveLength(4);
		scenario.sqlite.close();
	});

	it("reports an unresolved space per item and still creates the next item", async () => {
		const f = batchFixture();
		const response = await f.post("Create", {
			items: [{ ...memoryInput, space: "missing" }, memoryInput],
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as BatchResponse;
		expect(body.results[0]).toMatchObject({ ok: false, error: { code: "not_found" } });
		expect(body.results[1]?.ok).toBe(true);
		expect(f.sqlite.prepare("SELECT * FROM memories").all()).toHaveLength(1);
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
		expect(f.sqlite.prepare("SELECT * FROM memories").all()).toHaveLength(3);
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
		const svc = new BatchMemoryService();
		const f = batchFixture(svc);
		vi.spyOn(svc, "create").mockImplementationOnce(async (_input, ctx) => {
			ctx.statements.push(ctx.db.prepare("DELETE FROM spaces WHERE id = 'space:kb'"));
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
		expect(f.sqlite.prepare("SELECT * FROM memories").all()).toHaveLength(1);
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
