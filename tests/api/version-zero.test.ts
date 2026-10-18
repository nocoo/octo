import { beforeAll, describe, expect, it } from "vitest";
import { base, createMemory, e2eD1, post, seedKey, seedSpace } from "../fixtures/l2-batch";
import { callTool, type RpcResponse, type ToolResult } from "./mcp-helpers";

let token: string;
let readonlyToken: string;
let hiddenToken: string;
let space: string;

beforeAll(async () => {
	const d1 = await e2eD1();
	token = (await seedKey(d1)).token;
	readonlyToken = (await seedKey(d1, { ops: "r" })).token;
	hiddenToken = (await seedKey(d1, { scope: "spaces", spaceIds: [] })).token;
	space = (await seedSpace(d1)).slug;
});

const conflict = { code: "version_conflict", details: { current_version: 1 } };
const operations = [
	["PATCH", "", { title: "original" }],
	["POST", "/rollback", { to_version: 1 }],
	["PUT", "/vector", { profile: "te3-small-1536", values: [1, ...Array(1535).fill(0)] }],
] as const;

function request(id: string, method: string, suffix: string, body: unknown, headers = {}) {
	return fetch(`${base}/api/v1/memories/${id}${suffix}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			...headers,
		},
		body: JSON.stringify(body),
	});
}

async function invoke(args: Record<string, unknown>): Promise<ToolResult> {
	const response = await callTool(token, "update_memory", args);
	expect(response.status).toBe(200);
	const body = (await response.json()) as RpcResponse;
	expect(body.error).toBeUndefined();
	expect(body.result).toBeDefined();
	return body.result as unknown as ToolResult;
}

async function unchanged(id: string) {
	const response = await fetch(`${base}/api/v1/memories/${id}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({ id, title: "original", version: 1 });
	const versions = await fetch(`${base}/api/v1/memories/${id}/versions`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(versions.status).toBe(200);
	const history = (await versions.json()) as { items: unknown[] };
	expect(history).toMatchObject({ items: [{ version: 1 }] });
	expect(history.items).toHaveLength(1);
}

describe("zero expected version HTTP contract", () => {
	it("returns 409 with current_version for body, plain/quoted header and matching zero versions", async () => {
		const { id } = await createMemory(token, { space, title: "original" });
		for (const [method, suffix, fields] of operations) {
			for (const [version, headers] of [
				[{ expected_version: 0 }, {}],
				[{}, { "If-Match": "0" }],
				[{}, { "If-Match": '"0"' }],
				[{ expected_version: 0 }, { "If-Match": '"0"' }],
			] as const) {
				const response = await request(id, method, suffix, { ...fields, ...version }, headers);
				expect(response.status, `${method} ${suffix}`).toBe(409);
				expect(await response.json()).toMatchObject({ error: conflict });
			}
		}
		await unchanged(id);
	});

	it("returns per-item batch conflicts and MCP tool conflicts for both update forms", async () => {
		const { id } = await createMemory(token, { space, title: "original" });
		const items = [
			{ id, title: "original", expected_version: 0 },
			{ id, patch: { title: "original", expected_version: 0 } },
		];
		const batch = await post("Update", token, { items });
		expect(batch.status).toBe(200);
		expect(await batch.json()).toMatchObject({
			results: [
				{ ok: false, error: conflict },
				{ ok: false, error: conflict },
			],
		});
		for (const item of items) {
			expect(await invoke(item)).toMatchObject({
				isError: true,
				structuredContent: { error: conflict },
			});
		}
		await unchanged(id);
	});

	it("keeps negative, fractional, string and mismatched versions invalid", async () => {
		const { id } = await createMemory(token, { space, title: "original" });
		for (const [method, suffix, fields] of operations) {
			for (const expected_version of [-1, 1.5, "0"]) {
				const response = await request(id, method, suffix, { ...fields, expected_version });
				expect(response.status).toBe(400);
				expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
			}
			for (const header of ["-1", 'W/"0"', "0,1", "1"]) {
				expect(
					(
						await request(
							id,
							method,
							suffix,
							{ ...fields, expected_version: 0 },
							{ "If-Match": header },
						)
					).status,
				).toBe(400);
			}
		}
		for (const expected_version of [-1, 1.5, "0"]) {
			for (const item of [
				{ id, title: "new", expected_version },
				{ id, patch: { title: "new", expected_version } },
			]) {
				expect((await post("Update", token, { items: [item] })).status).toBe(400);
				expect(await invoke(item)).toMatchObject({
					isError: true,
					structuredContent: { error: { code: "validation_failed" } },
				});
			}
		}
		await unchanged(id);
	});

	it("preserves authentication and scope denials without disclosing current_version", async () => {
		const { id } = await createMemory(token, { space, title: "original" });
		for (const [method, suffix, fields] of operations) {
			for (const [deniedToken, status, code] of [
				["", 401, "unauthenticated"],
				[readonlyToken, 403, "forbidden"],
				[hiddenToken, 404, "not_found"],
			] as const) {
				const response = await request(
					id,
					method,
					suffix,
					{ ...fields, expected_version: 0 },
					{ Authorization: deniedToken ? `Bearer ${deniedToken}` : "" },
				);
				expect(response.status).toBe(status);
				const body = await response.json();
				expect(body).toMatchObject({ error: { code } });
				expect(JSON.stringify(body)).not.toContain("current_version");
			}
		}
		await unchanged(id);
	});
});
