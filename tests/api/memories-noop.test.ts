import { describe, expect, it } from "vitest";
import { base, e2eD1, post, query, seedKey, seedSpace, sqlText } from "../fixtures/l2-batch";
import { callTool, type RpcResponse, type ToolResult } from "./mcp-helpers";

async function fixture(vector = false) {
	const d1 = await e2eD1();
	const key = await seedKey(d1);
	const space = await seedSpace(d1);
	const profile = `noop-${crypto.randomUUID()}`;
	await d1([
		"--command",
		`INSERT INTO embedding_profiles (id, model, dims, metric, vectorize_index, active, created_at) VALUES (${sqlText(profile)}, 'tiny-noop', 3, 'cosine', 'local-only', 0, 0)`,
	]);
	const input = {
		space: space.slug,
		title: `No-op ${crypto.randomUUID()}`,
		body: "Stable memory content",
		type: "note",
		tags: ["Noop-Zulu", "Noop-Alpha"],
		importance: 0,
		event_time: "2026-10-18T00:00:00Z",
	};
	const headers = { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" };
	const response = await fetch(`${base}/api/v1/memories`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			...input,
			...(vector ? { vector: { profile, values: [0, 3, 4] } } : {}),
		}),
	});
	expect(response.status).toBe(201);
	const current = (await response.json()) as Record<string, unknown>;
	const id = String(current.id);
	const path = `${base}/api/v1/memories/${id}`;
	const patch = (body: unknown, extraHeaders = {}) =>
		fetch(path, {
			method: "PATCH",
			headers: { ...headers, ...extraHeaders },
			body: JSON.stringify(body),
		});
	const snapshot = async () => {
		const rows = [];
		for (const [table, column] of [
			["memories", "id"],
			["memory_versions", "memory_id"],
			["memory_tags", "memory_id"],
			["memories_fts_map", "memory_id"],
			["changes", "entity_id"],
			["memory_vectors", "memory_id"],
			["vector_sync_jobs", "memory_id"],
		])
			rows.push(
				await query(d1, `SELECT * FROM ${table} WHERE ${column} = ${sqlText(id)} ORDER BY rowid`),
			);
		return rows;
	};
	return { d1, key, input, current, id, profile, patch, snapshot };
}

describe("memory no-op HTTP contract", () => {
	it.each([false, true])(
		"preserves all memory state for REST, batch and MCP no-ops with vector=%s",
		async (vector) => {
			const { d1, key, input, current, id, profile, patch, snapshot } = await fixture(vector);
			const before = await snapshot();
			const normalized = {
				...input,
				tags: [" ＮＯＯＰ－ＺＵＬＵ ", "noop-alpha", "Noop-Zulu"],
				event_time: "2026-10-18T00:00:00.000Z",
				vector: vector ? { profile, values: [0, 6, 8] } : null,
			};
			const rest = await patch(normalized, { "If-Match": '"1"' });
			expect(rest.status).toBe(200);
			expect(await rest.json()).toEqual(current);
			const batch = await post("Update", key.token, {
				items: [
					{ id, ...normalized, expected_version: 1 },
					{ id, patch: { ...normalized, expected_version: 1 } },
					{ id, title: input.title, expected_version: 9 },
				],
			});
			expect(batch.status).toBe(200);
			expect(await batch.json()).toMatchObject({
				results: [
					{ ok: true, item: current },
					{ ok: true, item: current },
					{ ok: false, error: { code: "version_conflict", details: { current_version: 1 } } },
				],
			});
			for (const args of [
				{ id, ...normalized, expected_version: 1 },
				{ id, patch: { ...normalized, expected_version: 1 } },
			]) {
				const response = await callTool(key.token, "update_memory", args);
				expect(response.status).toBe(200);
				const rpc = (await response.json()) as RpcResponse;
				const result = rpc.result as ToolResult;
				expect(result.isError).not.toBe(true);
				expect(result.structuredContent).toEqual(current);
			}
			const stale = await patch({ title: input.title, expected_version: 9 });
			expect(stale.status).toBe(409);
			expect(await stale.json()).toMatchObject({
				error: { code: "version_conflict", details: { current_version: 1 } },
			});
			const staleMcp = await callTool(key.token, "update_memory", {
				id,
				title: input.title,
				expected_version: 9,
			});
			const rpc = (await staleMcp.json()) as RpcResponse;
			expect(rpc.result).toMatchObject({
				isError: true,
				structuredContent: { error: { code: "version_conflict", details: { current_version: 1 } } },
			});
			expect(await snapshot()).toEqual(before);
			expect(
				await query(
					d1,
					`SELECT count(*) AS n FROM mcp_audit_writes mw JOIN audit_log a ON mw.audit_id = a.id WHERE a.actor = ${sqlText(`key:${key.id}`)}`,
				),
			).toEqual([{ n: 0 }]);
		},
	);

	it("does not consume staged versions for repeated IDs but still versions tag order changes", async () => {
		const { d1, key, id, input, profile } = await fixture(true);
		const response = await post("Update", key.token, {
			items: [
				{ id, title: input.title, expected_version: 1 },
				{ id, vector: { profile, values: [1, 0, 0] }, expected_version: 1 },
				{ id, patch: { vector: { profile, values: [2, 0, 0] }, expected_version: 2 } },
				{ id, title: input.title, expected_version: 1 },
				{ id, vector: null, expected_version: 2 },
				{ id, patch: { vector: null, expected_version: 3 } },
				{ id, tags: ["noop-alpha", "noop-zulu"], expected_version: 3 },
				{ id, tags: ["NOOP-ALPHA", "noop-zulu", "Noop-Alpha"], expected_version: 4 },
			],
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			results: [
				{ ok: true, item: { version: 1 } },
				{ ok: true, item: { version: 2 } },
				{ ok: true, item: { version: 2 } },
				{ ok: false, error: { code: "version_conflict", details: { current_version: 2 } } },
				{ ok: true, item: { version: 3 } },
				{ ok: true, item: { version: 3 } },
				{ ok: true, item: { version: 4, tags: ["noop-alpha", "noop-zulu"] } },
				{ ok: true, item: { version: 4, tags: ["noop-alpha", "noop-zulu"] } },
			],
		});
		expect(
			await query(
				d1,
				`SELECT version FROM memory_versions WHERE memory_id = ${sqlText(id)} ORDER BY version`,
			),
		).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
		expect(
			await query(
				d1,
				`SELECT count(*) AS n FROM changes WHERE entity = 'memory' AND entity_id = ${sqlText(id)}`,
			),
		).toEqual([{ n: 4 }]);
	});
});
