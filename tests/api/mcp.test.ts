import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";
import {
	base,
	createMemory,
	e2eD1,
	query,
	seedKey,
	seedSpace,
	sqlText,
} from "../fixtures/l2-batch";
import {
	callTool,
	MCP_ACCEPT,
	MCP_PROTOCOL_VERSION,
	postMcp,
	type RpcResponse,
	rpcEnvelope,
	type ToolResult,
} from "./mcp-helpers";

const toolNames = [
	"search",
	"get_memory",
	"batch_get",
	"create_memory",
	"update_memory",
	"delete_memory",
	"list_changes",
	"list_tags",
	"list_spaces",
];

function rpcId(body: RpcResponse): string | number | null | undefined {
	return body.id;
}

async function rpcBody(response: Response): Promise<RpcResponse> {
	return (await response.json()) as RpcResponse;
}

async function toolSuccess(response: Response): Promise<ToolResult> {
	expect(response.status).toBe(200);
	const body = await rpcBody(response);
	expect(body.error).toBeUndefined();
	expect(body.result).toBeDefined();
	const result = body.result as unknown as ToolResult;
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toBeDefined();
	const text = result.content.find((part) => part.type === "text")?.text;
	expect(text).toBeDefined();
	expect(JSON.parse(text as string)).toEqual(result.structuredContent);
	return result;
}

async function toolError(response: Response, code: string): Promise<ToolResult> {
	expect(response.status).toBe(200);
	const body = await rpcBody(response);
	expect(body.error).toBeUndefined();
	expect(body.result).toBeDefined();
	const result = body.result as unknown as ToolResult;
	expect(result.isError).toBe(true);
	expect(result.structuredContent).toMatchObject({ error: { code } });
	const text = result.content.find((part) => part.type === "text")?.text;
	expect(text).toBeDefined();
	expect(JSON.parse(text as string)).toEqual(result.structuredContent);
	return result;
}

async function createSeedMemory(token: string, space: string, suffix: string, tags: string[] = []) {
	return createMemory(token, {
		space,
		title: `MCP ${suffix}`,
		body: `MCP body ${suffix}`,
		type: "note",
		tags,
	});
}

async function tableCounts(d1: Awaited<ReturnType<typeof e2eD1>>) {
	return query<{
		memories: number;
		memory_versions: number;
		memory_tags: number;
		tags: number;
		changes: number;
		memories_fts: number;
		memories_fts_map: number;
	}>(
		d1,
		`SELECT
			(SELECT count(*) FROM memories) AS memories,
			(SELECT count(*) FROM memory_versions) AS memory_versions,
			(SELECT count(*) FROM memory_tags) AS memory_tags,
			(SELECT count(*) FROM tags) AS tags,
			(SELECT count(*) FROM changes) AS changes,
			(SELECT count(*) FROM memories_fts) AS memories_fts,
			(SELECT count(*) FROM memories_fts_map) AS memories_fts_map`,
	);
}

describe("stateless MCP Streamable HTTP", () => {
	it("rolls up logical tool errors and committed writes instead of POST counts", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const space = await seedSpace(d1);
		expect((await postMcp(key.token, rpcEnvelope("tools/list"))).status).toBe(200);
		await toolError(await callTool(key.token, "get_memory", { id: "missing" }), "not_found");
		await toolSuccess(
			await callTool(key.token, "create_memory", {
				space: space.slug,
				title: "usage",
				body: "usage",
				type: "note",
				tags: [],
			}),
		);
		await query(d1, "SELECT 1");
		expect((await fetch(`${base}/api/__test/cron`, { method: "POST" })).status).toBe(200);
		expect(
			await query(
				d1,
				`SELECT calls, errors, writes FROM usage_daily WHERE key_id = ${sqlText(key.id)}`,
			),
		).toEqual([{ calls: 3, errors: 1, writes: 1 }]);
		for (const method of ["PUT", "PATCH", "OPTIONS"]) {
			const response = await fetch(`${base}/mcp`, {
				method,
				headers: { Authorization: `Bearer ${key.token}` },
			});
			expect(response.status).toBe(405);
			expect(
				await query(
					d1,
					`SELECT route, error_code FROM audit_log WHERE request_id = ${sqlText(response.headers.get("X-Request-Id") ?? "")}`,
				),
			).toEqual([{ route: "/mcp", error_code: "validation_failed" }]);
		}
	});

	it("initializes, accepts initialized notification, and lists all nine stable tool schemas", async () => {
		const d1 = await e2eD1();
		const full = await seedKey(d1);
		const reader = await seedKey(d1, { ops: "r" });
		const initialize = rpcEnvelope("initialize", {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "octo-l2", version: "1.0.0" },
		});
		const initialized = await postMcp(full.token, initialize, { protocolVersion: null });
		expect(initialized.status).toBe(200);
		expect(initialized.headers.get("content-type")).toContain("application/json");
		expect(initialized.headers.get("Mcp-Session-Id")).toBeNull();
		const initBody = await rpcBody(initialized);
		expect(initBody).toMatchObject({
			jsonrpc: "2.0",
			id: initialize.id,
			result: {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: { tools: expect.any(Object) },
				serverInfo: { name: expect.any(String), version: expect.any(String) },
			},
		});

		const notification = await postMcp(full.token, {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
		expect(notification.status).toBe(202);
		expect(await notification.text()).toBe("");
		expect(notification.headers.get("Mcp-Session-Id")).toBeNull();

		const listed = await postMcp(full.token, rpcEnvelope("tools/list", {}));
		expect(listed.status).toBe(200);
		expect(listed.headers.get("Mcp-Session-Id")).toBeNull();
		const listBody = await rpcBody(listed);
		const tools = listBody.result?.tools as
			| Array<{
					name: string;
					inputSchema: Record<string, unknown>;
					outputSchema: Record<string, unknown>;
			  }>
			| undefined;
		expect(tools?.map((tool) => tool.name).sort()).toEqual([...toolNames].sort());
		for (const tool of tools ?? []) {
			expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
			expect(tool.outputSchema).toMatchObject({ type: "object" });
		}

		const restrictedList = await postMcp(reader.token, rpcEnvelope("tools/list", {}));
		const restrictedBody = await rpcBody(restrictedList);
		const restrictedTools = restrictedBody.result?.tools as Array<{ name: string }> | undefined;
		expect(restrictedTools?.map((tool) => tool.name).sort()).toEqual([...toolNames].sort());
	});

	it("interoperates with the official SDK client over HTTP and validates success and error schemas", async () => {
		const d1 = await e2eD1();
		const writer = await seedKey(d1);
		const noRead = await seedKey(d1, { ops: "w" });
		const space = await seedSpace(d1);
		const clients: Client[] = [];
		const connect = async (token: string) => {
			const client = new Client({ name: "octo-l2-sdk", version: "1.0.0" });
			clients.push(client);
			const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
				requestInit: { headers: { Authorization: `Bearer ${token}` } },
			});
			await client.connect(transport as Parameters<Client["connect"]>[0]);
			return client;
		};
		try {
			const client = await connect(writer.token);
			const listed = await client.listTools();
			expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...toolNames].sort());
			const createSchema = listed.tools.find((tool) => tool.name === "create_memory")?.outputSchema;
			expect(createSchema).toHaveProperty("anyOf");

			const title = `SDK-created ${crypto.randomUUID()}`;
			const created = await client.callTool({
				name: "create_memory",
				arguments: {
					space: space.slug,
					title,
					body: "created through the official SDK transport",
					type: "note",
					tags: [],
				},
			});
			expect(created.isError).not.toBe(true);
			expect(created.structuredContent).toMatchObject({ title, space: space.slug, version: 1 });
			const id = created.structuredContent?.id;
			expect(id).toEqual(expect.any(String));

			const gotten = await client.callTool({
				name: "get_memory",
				arguments: { id: id as string },
			});
			expect(gotten.isError).not.toBe(true);
			expect(gotten.structuredContent).toMatchObject({ id, title });

			const deniedClient = await connect(noRead.token);
			await deniedClient.listTools();
			const denied = await deniedClient.callTool({
				name: "get_memory",
				arguments: { id: id as string },
			});
			expect(denied.isError).toBe(true);
			expect(denied.structuredContent).toMatchObject({ error: { code: "forbidden" } });
		} finally {
			await Promise.all(clients.map((client) => client.close()));
		}
	});

	it("returns an independent response for concurrent requests reusing the same JSON-RPC id", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const space = await seedSpace(d1);
		const first = await createSeedMemory(key.token, space.slug, `parallel-${crypto.randomUUID()}`);
		const second = await createSeedMemory(key.token, space.slug, `parallel-${crypto.randomUUID()}`);
		const id = "same-rpc-id";
		const [one, two] = await Promise.all([
			callTool(key.token, "get_memory", { id: first.id }, { id }),
			callTool(key.token, "get_memory", { id: second.id }, { id }),
		]);
		const [oneBody, twoBody] = await Promise.all([rpcBody(one.clone()), rpcBody(two.clone())]);
		expect(rpcId(oneBody)).toBe(id);
		expect(rpcId(twoBody)).toBe(id);
		expect(one.headers.get("Mcp-Session-Id")).toBeNull();
		expect(two.headers.get("Mcp-Session-Id")).toBeNull();
		expect((await toolSuccess(one)).structuredContent?.id).toBe(first.id);
		expect((await toolSuccess(two)).structuredContent?.id).toBe(second.id);
	});

	it("serves all nine tools over real HTTP with the documented result shapes", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const space = await seedSpace(d1);
		const searchTerm = `mcpsearch${crypto.randomUUID().replaceAll("-", "")}`;
		const tagged = `mcptag${crypto.randomUUID().replaceAll("-", "")}`;
		const existing = await createMemory(key.token, {
			space: space.slug,
			title: `Search ${searchTerm}`,
			body: `distinct ${searchTerm} content`,
			type: "note",
			tags: [tagged],
		});

		const search = await toolSuccess(
			await callTool(key.token, "search", { query: searchTerm, mode: "fts", include: ["snippet"] }),
		);
		const searchData = search.structuredContent as {
			items: Array<{ id: string; snippet?: string }>;
			channels: { fts: { candidates: number; partial: boolean }; vector: { candidates: number } };
		};
		expect(searchData.items.map((item) => item.id)).toContain(existing.id);
		expect(searchData.channels.fts.candidates).toBeGreaterThan(0);
		expect(searchData.channels.vector).toBeDefined();

		const gotten = await toolSuccess(await callTool(key.token, "get_memory", { id: existing.id }));
		expect(gotten.structuredContent).toMatchObject({
			id: existing.id,
			space: space.slug,
			title: `Search ${searchTerm}`,
		});

		const missingId = `missing-${crypto.randomUUID()}`;
		const batch = await toolSuccess(
			await callTool(key.token, "batch_get", { ids: [existing.id, missingId] }),
		);
		expect(batch.structuredContent).toMatchObject({
			items: [expect.objectContaining({ id: existing.id })],
			missing: [missingId],
		});

		const createTitle = `Created ${crypto.randomUUID()}`;
		const createBody = `created body ${crypto.randomUUID()}`;
		const createTag = `mcpcreate${crypto.randomUUID().replaceAll("-", "")}`;
		const created = await toolSuccess(
			await callTool(key.token, "create_memory", {
				space: space.slug,
				title: createTitle,
				body: createBody,
				type: "procedure",
				tags: [createTag],
				importance: 0.8,
			}),
		);
		const createdMemory = created.structuredContent as {
			id: string;
			version: number;
			tags: string[];
		};
		expect(createdMemory).toMatchObject({ version: 1, tags: [createTag] });
		const createdId = sqlText(createdMemory.id);
		expect(
			await query<{ title: string; body: string; version: number }>(
				d1,
				`SELECT title, body, version FROM memories WHERE id = ${createdId}`,
			),
		).toEqual([{ title: createTitle, body: createBody, version: 1 }]);
		expect(
			await query<{ version: number; tags_json: string; op: string }>(
				d1,
				`SELECT version, tags_json, op FROM memory_versions WHERE memory_id = ${createdId}`,
			),
		).toEqual([{ version: 1, tags_json: JSON.stringify([createTag]), op: "create" }]);
		expect(
			await query<{ name: string }>(
				d1,
				`SELECT t.name FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.memory_id = ${createdId}`,
			),
		).toEqual([{ name: createTag }]);
		expect(
			await query<{ op: string; version: number }>(
				d1,
				`SELECT op, version FROM changes WHERE entity = 'memory' AND entity_id = ${createdId}`,
			),
		).toEqual([{ op: "created", version: 1 }]);
		expect(
			await query<{ memory_id: string }>(
				d1,
				`SELECT memory_id FROM memories_fts_map WHERE memory_id = ${createdId} AND fts_rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ${sqlText(createTag)})`,
			),
		).toEqual([{ memory_id: createdMemory.id }]);

		const updated = await toolSuccess(
			await callTool(key.token, "update_memory", {
				id: existing.id,
				patch: { title: `Updated ${crypto.randomUUID()}`, expected_version: 1 },
			}),
		);
		const updatedMemory = updated.structuredContent as { title: string; version: number };
		expect(updatedMemory.version).toBe(2);
		expect(updatedMemory.title).not.toBe(`Search ${searchTerm}`);
		expect(
			await query<{ title: string; version: number }>(
				d1,
				`SELECT title, version FROM memories WHERE id = ${sqlText(existing.id)}`,
			),
		).toEqual([{ title: updatedMemory.title, version: 2 }]);
		expect(
			await query<{ version: number; op: string }>(
				d1,
				`SELECT version, op FROM memory_versions WHERE memory_id = ${sqlText(existing.id)} ORDER BY version`,
			),
		).toEqual([
			{ version: 1, op: "create" },
			{ version: 2, op: "update" },
		]);
		expect(
			await query<{ op: string }>(
				d1,
				`SELECT op FROM changes WHERE entity = 'memory' AND entity_id = ${sqlText(existing.id)} ORDER BY seq`,
			),
		).toEqual([{ op: "created" }, { op: "updated" }]);

		const deleted = await toolSuccess(
			await callTool(key.token, "delete_memory", { id: createdMemory.id }),
		);
		const deletedData = deleted.structuredContent as { trashed_at: string };
		expect(deletedData.trashed_at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
		expect(
			await query<{ deleted_at: number | null }>(
				d1,
				`SELECT deleted_at FROM memories WHERE id = ${createdId}`,
			),
		).toEqual([{ deleted_at: Date.parse(deletedData.trashed_at) }]);
		expect(
			await query<{ op: string }>(
				d1,
				`SELECT op FROM changes WHERE entity = 'memory' AND entity_id = ${createdId} ORDER BY seq`,
			),
		).toEqual([{ op: "created" }, { op: "trashed" }]);

		const changes = await toolSuccess(
			await callTool(key.token, "list_changes", { spaces: [space.slug] }),
		);
		expect(changes.structuredContent).toMatchObject({
			items: expect.arrayContaining([
				expect.objectContaining({ entity: "memory", entity_id: existing.id, op: "updated" }),
			]),
			next_cursor: null,
		});

		const tags = await toolSuccess(await callTool(key.token, "list_tags", {}));
		expect(tags.structuredContent).toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({ name: tagged, use_count: 1 })]),
			next_cursor: null,
		});

		const spaces = await toolSuccess(await callTool(key.token, "list_spaces", {}));
		expect(spaces.structuredContent).toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({ slug: space.slug })]),
			next_cursor: null,
		});
	});

	it("denies every tool when its required v1 operation is absent", async () => {
		const d1 = await e2eD1();
		const owner = await seedKey(d1);
		const space = await seedSpace(d1);
		const memory = await createSeedMemory(owner.token, space.slug, crypto.randomUUID());
		const needle = `mcpdenied${crypto.randomUUID().replaceAll("-", "")}`;
		const cases: Array<{ name: string; ops: string; args: Record<string, unknown> }> = [
			{ name: "search", ops: "w,u,d", args: { query: needle, mode: "fts" } },
			{ name: "get_memory", ops: "w,u,d", args: { id: memory.id } },
			{ name: "batch_get", ops: "w,u,d", args: { ids: [memory.id] } },
			{
				name: "create_memory",
				ops: "r,u,d",
				args: { space: space.slug, title: "denied", body: "denied", type: "note", tags: [] },
			},
			{
				name: "update_memory",
				ops: "r,w,d",
				args: { id: memory.id, patch: { title: "denied", expected_version: 1 } },
			},
			{ name: "delete_memory", ops: "r,w,u", args: { id: memory.id } },
			{ name: "list_changes", ops: "w,u,d", args: {} },
			{ name: "list_tags", ops: "w,u,d", args: {} },
			{ name: "list_spaces", ops: "w,u,d", args: {} },
		];
		for (const item of cases) {
			const denied = await seedKey(d1, { ops: item.ops });
			await toolError(await callTool(denied.token, item.name, item.args), "forbidden");
		}
		expect(
			await query<{ version: number; deleted_at: number | null }>(
				d1,
				`SELECT version, deleted_at FROM memories WHERE id = ${sqlText(memory.id)}`,
			),
		).toEqual([{ version: 1, deleted_at: null }]);
	});

	it("hides out-of-scope spaces and memories from reads, search, batchGet, tags, changes, and counts", async () => {
		const d1 = await e2eD1();
		const writer = await seedKey(d1);
		const visible = await seedSpace(d1);
		const hidden = await seedSpace(d1);
		const scoped = await seedKey(d1, {
			ops: "r",
			scope: "spaces",
			spaceIds: [visible.id],
		});
		const visibleNeedle = `mcpvisible${crypto.randomUUID().replaceAll("-", "")}`;
		const hiddenNeedle = `mcphidden${crypto.randomUUID().replaceAll("-", "")}`;
		const visibleTag = `mcpvisibletag${crypto.randomUUID().replaceAll("-", "")}`;
		const hiddenTag = `mcphiddentag${crypto.randomUUID().replaceAll("-", "")}`;
		const shown = await createMemory(writer.token, {
			space: visible.slug,
			title: `visible ${visibleNeedle}`,
			body: visibleNeedle,
			type: "note",
			tags: [visibleTag],
		});
		const concealed = await createMemory(writer.token, {
			space: hidden.slug,
			title: `private ${hiddenNeedle}`,
			body: hiddenNeedle,
			type: "note",
			tags: [hiddenTag],
		});

		await toolError(await callTool(scoped.token, "get_memory", { id: concealed.id }), "not_found");
		const batch = await toolSuccess(
			await callTool(scoped.token, "batch_get", { ids: [shown.id, concealed.id, "missing-id"] }),
		);
		expect(batch.structuredContent).toMatchObject({
			items: [expect.objectContaining({ id: shown.id })],
			missing: [concealed.id, "missing-id"],
		});

		const search = await toolSuccess(
			await callTool(scoped.token, "search", { query: hiddenNeedle, mode: "fts" }),
		);
		expect(search.structuredContent).toMatchObject({ items: [] });

		const spaces = await toolSuccess(await callTool(scoped.token, "list_spaces", {}));
		const spaceItems = (spaces.structuredContent?.items ?? []) as Array<{
			slug: string;
			memory_count: number;
		}>;
		expect(spaceItems.map((item) => item.slug)).toContain(visible.slug);
		expect(spaceItems.map((item) => item.slug)).not.toContain(hidden.slug);
		const visibleSpace = spaceItems.find((item) => item.slug === visible.slug);
		expect(visibleSpace?.memory_count).toBe(1);

		const tags = await toolSuccess(await callTool(scoped.token, "list_tags", {}));
		const restTags = await fetch(`${base}/api/v1/tags`, {
			headers: { Authorization: `Bearer ${scoped.token}` },
		});
		expect(restTags.status).toBe(200);
		expect(tags.structuredContent).toEqual(await restTags.json());
		const tagItems = (tags.structuredContent?.items ?? []) as Array<{
			name: string;
			use_count: number;
		}>;
		expect(tagItems).toContainEqual(expect.objectContaining({ name: visibleTag, use_count: 1 }));
		expect(tagItems).toContainEqual(expect.objectContaining({ name: hiddenTag, use_count: 0 }));

		const changes = await toolSuccess(await callTool(scoped.token, "list_changes", {}));
		const changeItems = (changes.structuredContent?.items ?? []) as Array<{
			entity_id: string;
			space_id?: string;
		}>;
		expect(changeItems.map((item) => item.entity_id)).not.toContain(concealed.id);
		expect(changeItems.map((item) => item.space_id)).not.toContain(hidden.id);
	});

	it("preserves own_entries_only checks and requires authorization on both sides of a move", async () => {
		const d1 = await e2eD1();
		const source = await seedSpace(d1);
		const destination = await seedSpace(d1);
		const outside = await seedSpace(d1);
		const ownKey = await seedKey(d1, {
			ops: "r,w,u,d",
			scope: "spaces",
			spaceIds: [source.id, destination.id],
			ownEntriesOnly: true,
		});
		const other = await seedKey(d1);
		const ownMemory = await createSeedMemory(
			ownKey.token,
			source.slug,
			`own-${crypto.randomUUID()}`,
		);
		const foreignMemory = await createSeedMemory(
			other.token,
			source.slug,
			`foreign-${crypto.randomUUID()}`,
		);
		const hiddenMemory = await createSeedMemory(
			other.token,
			outside.slug,
			`hidden-${crypto.randomUUID()}`,
		);

		const moved = await toolSuccess(
			await callTool(ownKey.token, "update_memory", {
				id: ownMemory.id,
				patch: { space: destination.slug, title: "moved own memory", expected_version: 1 },
			}),
		);
		expect(moved.structuredContent).toMatchObject({
			id: ownMemory.id,
			space: destination.slug,
			version: 2,
		});
		expect(
			await query<{ space: string; version: number }>(
				d1,
				`SELECT s.slug AS space, m.version FROM memories m JOIN spaces s ON s.id = m.space_id WHERE m.id = ${sqlText(ownMemory.id)}`,
			),
		).toEqual([{ space: destination.slug, version: 2 }]);

		await toolError(
			await callTool(ownKey.token, "update_memory", {
				id: foreignMemory.id,
				patch: { title: "must stay foreign", expected_version: 1 },
			}),
			"forbidden",
		);
		await toolError(
			await callTool(ownKey.token, "delete_memory", { id: foreignMemory.id }),
			"forbidden",
		);
		await toolError(
			await callTool(ownKey.token, "update_memory", {
				id: hiddenMemory.id,
				patch: { title: "hidden", expected_version: 1 },
			}),
			"not_found",
		);
		await toolError(
			await callTool(ownKey.token, "update_memory", {
				id: ownMemory.id,
				patch: { space: outside.slug, expected_version: 2 },
			}),
			"not_found",
		);
		expect(
			await query<{ title: string; version: number }>(
				d1,
				`SELECT title, version FROM memories WHERE id = ${sqlText(ownMemory.id)}`,
			),
		).toEqual([{ title: "moved own memory", version: 2 }]);
	});

	it("returns hidden and nonexistent batch IDs together in missing", async () => {
		const d1 = await e2eD1();
		const owner = await seedKey(d1);
		const visible = await seedSpace(d1);
		const hidden = await seedSpace(d1);
		const scoped = await seedKey(d1, {
			ops: "r",
			scope: "spaces",
			spaceIds: [visible.id],
		});
		const visibleMemory = await createSeedMemory(owner.token, visible.slug, crypto.randomUUID());
		const hiddenMemory = await createSeedMemory(owner.token, hidden.slug, crypto.randomUUID());
		const absentId = `absent-${crypto.randomUUID()}`;
		const result = await toolSuccess(
			await callTool(scoped.token, "batch_get", {
				ids: [visibleMemory.id, hiddenMemory.id, absentId],
			}),
		);
		expect(result.structuredContent).toMatchObject({
			items: [expect.objectContaining({ id: visibleMemory.id })],
			missing: [hiddenMemory.id, absentId],
		});
	});

	it("returns validation and version failures as isError HTTP 200 without changing memory", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const space = await seedSpace(d1);
		const memory = await createSeedMemory(key.token, space.slug, crypto.randomUUID());
		const before = await query<{ title: string; version: number }>(
			d1,
			`SELECT title, version FROM memories WHERE id = ${sqlText(memory.id)}`,
		);
		const conflict = await toolError(
			await callTool(key.token, "update_memory", {
				id: memory.id,
				patch: { title: "stale write", expected_version: 99 },
			}),
			"version_conflict",
		);
		expect(conflict.structuredContent).toMatchObject({
			error: { details: { current_version: 1 } },
		});
		await toolError(
			await callTool(key.token, "update_memory", {
				id: memory.id,
				patch: { title: "missing expected version" },
			}),
			"validation_failed",
		);
		await toolError(
			await callTool(key.token, "create_memory", {
				space: space.slug,
				title: "",
				body: "invalid title",
				type: "note",
				tags: [],
			}),
			"validation_failed",
		);
		expect(
			await query<{ title: string; version: number }>(
				d1,
				`SELECT title, version FROM memories WHERE id = ${sqlText(memory.id)}`,
			),
		).toEqual(before);
		expect(
			await query<{ version: number }>(
				d1,
				`SELECT version FROM memory_versions WHERE memory_id = ${sqlText(memory.id)} ORDER BY version`,
			),
		).toEqual([{ version: 1 }]);
	});

	it("rolls back all staged create effects when the D1 batch fails", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const space = await seedSpace(d1);
		const suffix = crypto.randomUUID().replaceAll("-", "");
		const title = `MCP atomic ${suffix}`;
		const tag = `mcpatomic${suffix}`;
		const trigger = `mcp_fail_changes_${suffix}`;
		const before = await tableCounts(d1);
		await d1([
			"--command",
			`CREATE TRIGGER ${trigger} BEFORE INSERT ON changes WHEN NEW.entity = 'memory' AND NEW.op = 'created' BEGIN SELECT RAISE(ABORT, 'private injected commit failure'); END`,
		]);
		try {
			const failed = await callTool(key.token, "create_memory", {
				space: space.slug,
				title,
				body: `atomic body ${suffix}`,
				type: "note",
				tags: [tag],
			});
			const result = await toolError(failed, "unavailable");
			expect(JSON.stringify(result.structuredContent)).not.toContain(
				"private injected commit failure",
			);
			const after = await tableCounts(d1);
			expect(after).toEqual(before);
			expect(
				await query<{ count: number }>(
					d1,
					`SELECT count(*) AS count FROM memories WHERE title = ${sqlText(title)}`,
				),
			).toEqual([{ count: 0 }]);
			expect(
				await query<{ count: number }>(
					d1,
					`SELECT count(*) AS count FROM tags WHERE name = ${sqlText(tag)}`,
				),
			).toEqual([{ count: 0 }]);
		} finally {
			await d1(["--command", `DROP TRIGGER IF EXISTS ${trigger}`]);
		}
	});

	it("authenticates every request independently and never accepts Access as an API key", async () => {
		const d1 = await e2eD1();
		const invalidRequest = rpcEnvelope("tools/list", {});
		const missing = await postMcp(null, invalidRequest, { protocolVersion: null });
		expect(missing.status).toBe(401);
		expect(await missing.json()).toMatchObject({ error: { code: "unauthenticated" } });

		const bad = await postMcp("octo_invalid_key", invalidRequest, { protocolVersion: null });
		expect(bad.status).toBe(401);
		expect(await bad.json()).toMatchObject({ error: { code: "unauthenticated" } });

		const state = await loadJwksState();
		const jwt = await signAccessJwt(state, {
			iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
			aud: L2_ACCESS_AUD,
			exp: Math.floor(Date.now() / 1000) + 3600,
			email: "mcp-access-only@local",
		});
		const accessOnly = await postMcp(null, invalidRequest, {
			protocolVersion: null,
			extraHeaders: { "Cf-Access-Jwt-Assertion": jwt },
		});
		expect(accessOnly.status).toBe(401);
		expect(await accessOnly.json()).toMatchObject({ error: { code: "unauthenticated" } });

		const expired = await seedKey(d1);
		await d1([
			"--command",
			`UPDATE api_keys SET expires_at = ${Date.now() - 60_000} WHERE id = ${sqlText(expired.id)}`,
		]);
		const expiredResponse = await postMcp(expired.token, invalidRequest, { protocolVersion: null });
		expect(expiredResponse.status).toBe(401);
		expect(await expiredResponse.json()).toMatchObject({ error: { code: "unauthenticated" } });

		const revoked = await seedKey(d1);
		await d1([
			"--command",
			`UPDATE api_keys SET revoked_at = ${Date.now()} WHERE id = ${sqlText(revoked.id)}`,
		]);
		const revokedResponse = await postMcp(revoked.token, invalidRequest, { protocolVersion: null });
		expect(revokedResponse.status).toBe(401);
		expect(await revokedResponse.json()).toMatchObject({ error: { code: "unauthenticated" } });
	});

	it("maps malformed JSON, invalid envelopes, batches, and unknown RPC/tool calls", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const malformed = await postMcp(key.token, "{");
		expect(malformed.status).toBe(400);
		expect(await rpcBody(malformed)).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });

		const invalidEnvelope = await postMcp(key.token, {
			jsonrpc: "1.0",
			id: 1,
			method: "tools/list",
		});
		expect(invalidEnvelope.status).toBe(400);
		expect(await rpcBody(invalidEnvelope)).toMatchObject({
			jsonrpc: "2.0",
			error: { code: -32600 },
		});

		for (const batch of [[], [rpcEnvelope("tools/list", {})]]) {
			const response = await postMcp(key.token, batch);
			expect(response.status).toBe(400);
			expect(await rpcBody(response)).toMatchObject({ jsonrpc: "2.0", error: { code: -32600 } });
		}

		const unknownMethod = await postMcp(key.token, rpcEnvelope("unknown/method", {}));
		expect(unknownMethod.status).toBe(200);
		expect(await rpcBody(unknownMethod)).toMatchObject({ jsonrpc: "2.0", error: { code: -32601 } });

		const unknownTool = await postMcp(
			key.token,
			rpcEnvelope("tools/call", { name: `unknown-${crypto.randomUUID()}`, arguments: {} }),
		);
		expect(unknownTool.status).toBe(200);
		expect(await rpcBody(unknownTool)).toMatchObject({ jsonrpc: "2.0", error: { code: -32602 } });

		const invalidToolParams = await postMcp(key.token, rpcEnvelope("tools/call", {}));
		expect(invalidToolParams.status).toBe(200);
		expect(await rpcBody(invalidToolParams)).toMatchObject({
			jsonrpc: "2.0",
			error: { code: -32602 },
		});
	});

	it("enforces Streamable HTTP negotiation, origin policy, stateless methods, and protocol headers", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const request = rpcEnvelope("tools/list", {});

		for (const accept of [null, "application/json"]) {
			const response = await postMcp(key.token, request, { accept });
			expect(response.status).toBe(406);
			expect(await rpcBody(response)).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
		}
		for (const contentType of [null, "text/plain"]) {
			const response = await postMcp(key.token, request, { contentType });
			expect(response.status).toBe(415);
			expect(await rpcBody(response)).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
		}

		const allowedOrigin = await postMcp(key.token, request, { origin: "https://octo.hexly.ai" });
		expect(allowedOrigin.status).toBe(200);
		expect(allowedOrigin.headers.get("access-control-allow-origin")).toBeNull();
		const blockedOrigin = await postMcp(key.token, request, { origin: "https://attacker.example" });
		expect(blockedOrigin.status).toBe(403);
		expect(await blockedOrigin.json()).toMatchObject({ error: { code: "forbidden" } });
		expect(blockedOrigin.headers.get("access-control-allow-origin")).toBeNull();

		for (const method of ["GET", "DELETE", "PUT", "PATCH", "OPTIONS", "HEAD"]) {
			const response = await fetch(`${base}/mcp`, {
				method,
				headers: {
					Authorization: `Bearer ${key.token}`,
					Accept: MCP_ACCEPT,
					"MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
				},
			});
			expect(response.status).toBe(405);
			expect(response.headers.get("Allow")).toBe("POST");
			if (method !== "HEAD") {
				expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: expect.any(Object) });
			}
		}

		const unsupportedProtocol = await postMcp(key.token, request, {
			protocolVersion: "2099-01-01",
		});
		expect(unsupportedProtocol.status).toBe(400);
		expect(await rpcBody(unsupportedProtocol)).toMatchObject({
			jsonrpc: "2.0",
			error: { code: -32000 },
		});
	});

	it("audits MCP errors by route and actor without arguments, tool names, keys, or secrets", async () => {
		const d1 = await e2eD1();
		const key = await seedKey(d1);
		const space = await seedSpace(d1);
		const marker = `mcp-redaction-${crypto.randomUUID()}`;
		const unknownName = `arbitrary-tool-${marker}`;
		const unknown = await callTool(key.token, unknownName, { body: marker });
		expect(unknown.status).toBe(200);
		expect(await rpcBody(unknown)).toMatchObject({ error: { code: -32602 } });

		const invalidRequest = await callTool(key.token, "create_memory", {
			space: space.slug,
			title: "",
			body: marker,
			type: "note",
			tags: [],
		});
		await toolError(invalidRequest, "validation_failed");
		const requestId = invalidRequest.headers.get("X-Request-Id");
		expect(requestId).toBeTruthy();
		const audit = await query<{
			actor: string;
			method: string;
			route: string;
			status: number;
			request_id: string;
			error_code: string | null;
			bytes_in: number | null;
			bytes_out: number | null;
		}>(
			d1,
			`SELECT actor, method, route, status, request_id, error_code, bytes_in, bytes_out FROM audit_log WHERE request_id = ${sqlText(requestId as string)}`,
		);
		const contentLength = invalidRequest.headers.get("Content-Length");
		const expectedBytesOut =
			contentLength !== null &&
			/^\\d{1,10}$/.test(contentLength) &&
			Number(contentLength) <= 4_294_967_295
				? Number(contentLength)
				: null;
		expect(audit).toEqual([
			{
				actor: `key:${key.id}`,
				method: "POST",
				route: "/mcp",
				status: 200,
				request_id: requestId,
				error_code: "validation_failed",
				bytes_in: expect.any(Number),
				bytes_out: expectedBytesOut,
			},
		]);
		expect(JSON.stringify(audit)).not.toContain(marker);
		expect(JSON.stringify(audit)).not.toContain(unknownName);
		expect(JSON.stringify(audit)).not.toContain(key.token);
	});
});
