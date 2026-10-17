import { describe, expect, it } from "vitest";
import {
	type BatchBody,
	createMemory,
	e2eD1,
	effectCount,
	input,
	post,
	query,
	seedKey,
	seedSpace,
	sqlText,
	stored,
} from "../fixtures/l2-batch";

function payload(action: string, id = "missing") {
	return action === "Create"
		? { items: [input] }
		: action === "Update"
			? { items: [{ id, title: "updated", expected_version: 1 }] }
			: { ids: [id] };
}

describe("batch endpoint success/failure/auth matrix", () => {
	it.each(["Create", "Update", "Delete"])(
		"batch%s requires real M1 bearer authentication",
		async (action) => {
			for (const token of [null, "octo_invalid"]) {
				const res = await post(action, token, payload(action));
				expect(res.status).toBe(401);
				expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
			}
		},
	);
	it.each(["Create", "Update", "Delete"])(
		"batch%s rejects malformed and oversized requests before effects",
		async (action) => {
			const d1 = await e2eD1();
			const key = await seedKey(d1);
			for (const body of [
				{ unknown: true },
				"{",
				action === "Delete" ? { ids: [1] } : { items: [{ unexpected: true }] },
			]) {
				const res = await post(action, key.token, body);
				expect(res.status).toBe(400);
				expect(await res.json()).toMatchObject({ error: { code: "validation_failed" } });
			}
			const body =
				action === "Delete"
					? { ids: Array(101).fill("missing") }
					: {
							items: Array.from({ length: 101 }, () =>
								action === "Create" ? input : { id: "missing", title: "t", expected_version: 1 },
							),
						};
			const tooLarge = await post(action, key.token, body);
			expect(tooLarge.status).toBe(413);
			expect(await tooLarge.json()).toMatchObject({ error: { code: "payload_too_large" } });
			expect(await effectCount(d1, key.id)).toBe(0);
		},
	);
	it.each(["Create", "Update", "Delete"])(
		"batch%s denies readonly keys without changing persisted data",
		async (action) => {
			const d1 = await e2eD1();
			const writer = await seedKey(d1);
			const readonly = await seedKey(d1, { ops: "r" });
			const item = await createMemory(writer.token);
			const before = await stored(d1, item.id);
			const res = await post(action, readonly.token, payload(action, item.id));
			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({
				results: [{ ok: false, error: { code: "forbidden" } }],
			});
			expect(await stored(d1, item.id)).toEqual(before);
			expect(await effectCount(d1, readonly.id)).toBe(0);
		},
	);
	it("batchCreate persists each successful item and reports missing spaces individually", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const tagged = { ...input, tags: ["BatchShared"] };
		const res = await post("Create", key.token, {
			items: [tagged, { ...input, space: "nonexistent-space" }, { ...tagged, title: "third" }],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as BatchBody;
		expect(body.results.map((r) => r.ok)).toEqual([true, false, true]);
		expect(body.results[1]?.error?.code).toBe("not_found");
		expect(await effectCount(d1, key.id)).toBe(2);
		for (const result of [body.results[0], body.results[2]]) {
			expect(result?.item?.version).toBe(1);
			const persisted = await stored(d1, result?.item?.id ?? "");
			expect(persisted?.deleted_at).toBeNull();
			expect(persisted).toMatchObject({
				id: result?.item?.id,
				title: result?.item?.title,
				body: result?.item?.body,
				version: result?.item?.version,
			});
			const id = sqlText(result?.item?.id ?? "");
			expect(
				await query(
					d1,
					`SELECT version, tags_json, op FROM memory_versions WHERE memory_id = ${id}`,
				),
			).toEqual([{ version: 1, tags_json: '["batchshared"]', op: "create" }]);
			expect(
				await query(
					d1,
					`SELECT t.name FROM memory_tags mt INNER JOIN tags t ON t.id = mt.tag_id WHERE mt.memory_id = ${id}`,
				),
			).toEqual([{ name: "batchshared" }]);
			expect(
				await query(
					d1,
					`SELECT op, version FROM changes WHERE entity = 'memory' AND entity_id = ${id}`,
				),
			).toEqual([{ op: "created", version: 1 }]);
			expect(
				await query(
					d1,
					`SELECT memory_id FROM memories_fts_map WHERE memory_id = ${id} AND fts_rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'batchshared')`,
				),
			).toEqual([{ memory_id: result?.item?.id }]);
		}
	});
	it("batchUpdate persists title/version changes and leaves stale and missing items unchanged", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const item = await createMemory(key.token);
		const res = await post("Update", key.token, {
			items: [
				{ id: item.id, title: "updated", expected_version: 1 },
				{ id: item.id, title: "stale", expected_version: 1 },
				{ id: "missing", title: "missing", expected_version: 1 },
			],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as BatchBody;
		expect(body.results[0]).toMatchObject({
			ok: true,
			item: { id: item.id, title: "updated", version: 2 },
		});
		expect(body.results[1]).toMatchObject({ ok: false, error: { code: "version_conflict" } });
		expect(body.results[2]).toMatchObject({ ok: false, error: { code: "not_found" } });
		expect(await stored(d1, item.id)).toMatchObject({
			title: "updated",
			version: 2,
		});
		expect(
			await query(
				d1,
				`SELECT title, version FROM memory_versions WHERE memory_id = ${sqlText(item.id)} ORDER BY version`,
			),
		).toEqual([
			{ title: "title", version: 1 },
			{ title: "updated", version: 2 },
		]);
		expect(
			await query(d1, `SELECT op FROM changes WHERE entity_id = ${sqlText(item.id)} ORDER BY seq`),
		).toEqual([{ op: "created" }, { op: "updated" }]);
		expect(
			await query(
				d1,
				`SELECT memory_id FROM memories_fts_map WHERE memory_id = ${sqlText(item.id)} AND fts_rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'updated')`,
			),
		).toEqual([{ memory_id: item.id }]);
	});
	it("batchDelete persists trash rather than removing the row and reports missing items", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const item = await createMemory(key.token);
		const res = await post("Delete", key.token, { ids: [item.id, item.id, "missing"] });
		expect(res.status).toBe(200);
		const body = (await res.json()) as BatchBody;
		expect(body.results[0]?.ok).toBe(true);
		expect(body.results[0]?.item?.trashed_at).toEqual(expect.any(String));
		expect(body.results.slice(1).map((r) => r.error?.code)).toEqual(["not_found", "not_found"]);
		const deletedAt = (await stored(d1, item.id))?.deleted_at;
		expect(deletedAt).toEqual(expect.any(Number));
		expect(new Date(deletedAt ?? 0).toISOString()).toBe(body.results[0]?.item?.trashed_at);
		expect(
			await query(d1, `SELECT version FROM memory_versions WHERE memory_id = ${sqlText(item.id)}`),
		).toEqual([{ version: 1 }]);
		expect(
			await query(d1, `SELECT op FROM changes WHERE entity_id = ${sqlText(item.id)} ORDER BY seq`),
		).toEqual([{ op: "created" }, { op: "trashed" }]);
		expect(
			await query(
				d1,
				`SELECT memory_id FROM memories_fts_map WHERE memory_id = ${sqlText(item.id)} AND fts_rowid IN (SELECT rowid FROM memories_fts)`,
			),
		).toEqual([]);
	});
	it.each(["spaces", "own"] as const)(
		"resolves real IDs for %s scope and enforces own-entry mutation and moves",
		async (scope) => {
			const d1 = await e2eD1();
			const key = await seedKey(d1, { scope, ownEntriesOnly: true });
			const source = await seedSpace(d1, key.id);
			const destination = await seedSpace(d1, key.id);
			if (scope === "spaces")
				await d1([
					"--command",
					`UPDATE api_keys SET space_ids_json = '${JSON.stringify([source.id, destination.id])}' WHERE id = '${key.id}'`,
				]);
			const otherKey = await seedKey(d1);
			const own = await createMemory(key.token, { space: source.slug });
			const foreign = await createMemory(otherKey.token, { space: source.slug });
			const hidden = await createMemory(otherKey.token);
			const beforeForeign = await stored(d1, foreign.id);
			const beforeHidden = await stored(d1, hidden.id);
			const updated = await post("Update", key.token, {
				items: [own, foreign, hidden].map((item) => ({
					id: item.id,
					space: destination.slug,
					expected_version: 1,
				})),
			});
			expect(updated.status).toBe(200);
			const body = (await updated.json()) as BatchBody;
			expect(body.results.map((r) => r.ok)).toEqual([true, false, false]);
			expect(body.results.slice(1).map((r) => r.error?.code)).toEqual(["forbidden", "not_found"]);
			expect(await stored(d1, own.id)).toMatchObject({
				space: destination.slug,
				space_id: destination.id,
				version: 2,
			});
			const deleted = await post("Delete", key.token, { ids: [own.id, foreign.id, hidden.id] });
			expect(deleted.status).toBe(200);
			const deletedBody = (await deleted.json()) as BatchBody;
			expect(deletedBody.results.map((r) => r.ok)).toEqual([true, false, false]);
			expect(deletedBody.results.slice(1).map((r) => r.error?.code)).toEqual([
				"forbidden",
				"not_found",
			]);
			expect((await stored(d1, own.id))?.deleted_at).toEqual(expect.any(Number));
			expect(await stored(d1, foreign.id)).toEqual(beforeForeign);
			expect(await stored(d1, hidden.id)).toEqual(beforeHidden);
			const deniedCreate = await post("Create", key.token, { items: [input] });
			expect(await deniedCreate.json()).toMatchObject({
				results: [{ ok: false, error: { code: "not_found" } }],
			});
		},
	);
});
