import { beforeAll, describe, expect, it } from "vitest";
import { base, createMemory, e2eD1, post, seedKey, seedSpace } from "../fixtures/l2-batch";
import { callTool, type RpcResponse, type ToolResult } from "./mcp-helpers";

let token: string;
let space: string;

beforeAll(async () => {
	const d1 = await e2eD1();
	token = (await seedKey(d1)).token;
	space = (await seedSpace(d1)).slug;
});

async function read(id: string) {
	const response = await fetch(`${base}/api/v1/memories/${id}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(response.status).toBe(200);
	return response.json();
}

async function invoke(name: string, args: Record<string, unknown>): Promise<ToolResult> {
	const response = await callTool(token, name, args);
	expect(response.status).toBe(200);
	const body = (await response.json()) as RpcResponse;
	expect(body.error).toBeUndefined();
	expect(body.result).toBeDefined();
	return body.result as unknown as ToolResult;
}

describe("flat and nested memory update acceptance", () => {
	it("round-trips both REST batch forms, rejects mixing atomically and preserves rollback", async () => {
		const { id } = await createMemory(token, { space, title: "original" });
		const response = await post("Update", token, {
			items: [
				{ id, title: "flat REST", importance: 0, expected_version: 1 },
				{ id, patch: { body: "nested REST", importance: 1, expected_version: 2 } },
			],
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			results: [
				{ ok: true, item: { id, title: "flat REST", importance: 0, version: 2 } },
				{
					ok: true,
					item: { id, title: "flat REST", body: "nested REST", importance: 1, version: 3 },
				},
			],
		});
		for (const invalid of [
			{ id, title: "flat", expected_version: 3, patch: { body: "disjoint", expected_version: 3 } },
			{ id, expected_version: 3, patch: { title: "nested" } },
			{ id, title: "flat", patch: { body: "nested", expected_version: 3 } },
			{ id, title: "missing version" },
			{ id, patch: { title: "missing version" } },
			{ id, importance: -0.01, expected_version: 3 },
			{ id, patch: { importance: 1.01, expected_version: 3 } },
		]) {
			const denied = await post("Update", token, {
				items: [{ id, title: "must not commit", expected_version: 3 }, invalid],
			});
			expect(denied.status).toBe(400);
			expect(await denied.json()).toMatchObject({ error: { code: "validation_failed" } });
		}
		expect(await read(id)).toMatchObject({
			id,
			title: "flat REST",
			body: "nested REST",
			importance: 1,
			version: 3,
		});
		const stale = await post("Update", token, {
			items: [
				{ id, title: "stale", expected_version: 1 },
				{ id, patch: { title: "stale", expected_version: 2 } },
			],
		});
		expect(stale.status).toBe(200);
		expect(await stale.json()).toMatchObject({
			results: [
				{ ok: false, error: { code: "version_conflict", details: { current_version: 3 } } },
				{ ok: false, error: { code: "version_conflict", details: { current_version: 3 } } },
			],
		});
		const rollback = await fetch(`${base}/api/v1/memories/${id}/rollback`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"If-Match": "3",
			},
			body: JSON.stringify({ to_version: 1 }),
		});
		expect(rollback.status).toBe(200);
		expect(await rollback.json()).toMatchObject({ id, title: "original", version: 4 });
	});

	it("round-trips both MCP forms through REST and rejects disjoint mixed fields before writes", async () => {
		const created = await invoke("create_memory", {
			space,
			title: "original MCP",
			body: "body",
			type: "note",
			tags: [],
			importance: 0.5,
		});
		expect(created.isError).not.toBe(true);
		const id = String(created.structuredContent?.id);
		const flat = await invoke("update_memory", {
			id,
			title: "flat MCP",
			importance: 0,
			expected_version: 1,
		});
		expect(flat.isError).not.toBe(true);
		expect(flat.structuredContent).toMatchObject({
			id,
			title: "flat MCP",
			importance: 0,
			version: 2,
		});
		const nested = await invoke("update_memory", {
			id,
			patch: { body: "nested MCP", importance: 1, expected_version: 2 },
		});
		expect(nested.isError).not.toBe(true);
		expect(nested.structuredContent).toMatchObject({
			id,
			title: "flat MCP",
			body: "nested MCP",
			importance: 1,
			version: 3,
		});
		for (const invalid of [
			{ id, title: "flat", expected_version: 3, patch: { body: "disjoint", expected_version: 3 } },
			{ id, expected_version: 3, patch: { title: "nested" } },
			{ id, title: "flat", patch: { body: "nested", expected_version: 3 } },
			{ id, title: "missing version" },
			{ id, patch: { title: "missing version" } },
			{ id, importance: -0.01, expected_version: 3 },
			{ id, patch: { importance: 1.01, expected_version: 3 } },
		]) {
			const denied = await invoke("update_memory", invalid);
			expect(denied.isError).toBe(true);
			expect(denied.structuredContent).toMatchObject({ error: { code: "validation_failed" } });
		}
		for (const args of [
			{ id, title: "stale", expected_version: 1 },
			{ id, patch: { title: "stale", expected_version: 2 } },
		]) {
			const stale = await invoke("update_memory", args);
			expect(stale.isError).toBe(true);
			expect(stale.structuredContent).toMatchObject({
				error: { code: "version_conflict", details: { current_version: 3 } },
			});
		}
		expect(await read(id)).toMatchObject({
			id,
			title: "flat MCP",
			body: "nested MCP",
			importance: 1,
			version: 3,
		});
	});
});
