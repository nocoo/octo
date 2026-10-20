import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { insertTinyProfile } from "../repo/__tests__/sqlite-d1";
import { memoryInput, names, setup } from "./__tests__/app";

describe("official MCP client interoperability", () => {
	it("negotiates HTTP and validates every tool's published output schema", async () => {
		const { app, env, headers, ctx, flush, db, sqlite, key } = await setup();
		sqlite.prepare("UPDATE api_keys SET role = 'admin' WHERE id = ?").run(key.row.id);
		await insertTinyProfile(db);
		await db.prepare("UPDATE embedding_profiles SET active = 1 WHERE id = 'tiny-3'").run();
		const vector = { profile: "tiny-3", values: [1, 0, 0] };
		const client = new Client({ name: "knowledge-bot", version: "1" });
		const transport = new StreamableHTTPClientTransport(new URL("http://local/mcp"), {
			requestInit: { headers: { Authorization: headers.Authorization } },
			fetch: async (input, init) => app.fetch(new Request(input, init), env, ctx),
		});
		try {
			await client.connect(transport as Parameters<Client["connect"]>[0]);
			expect(transport.sessionId).toBeUndefined();
			const listed = await client.listTools();
			expect(listed.tools.map((tool) => tool.name)).toEqual(names);
			const created = await client.callTool({
				name: "create_memory",
				arguments: { ...memoryInput, vector },
			});
			const id = (created.structuredContent as { id: string }).id;
			expect(id).toEqual(expect.any(String));
			const calls = [
				["create_space", { slug: "sdk-space", name: "SDK space" }],
				["update_space", { space: "sdk-space", description: "Updated" }],
				["get_memory", { id }],
				["batch_get", { ids: [id] }],
				["search", { query: "octopus", mode: "fts" }],
				["search", { query: "octopus", vector, mode: "hybrid", include: ["snippet"] }],
				["list_tags", {}],
				["list_spaces", {}],
				["list_changes", {}],
				["update_memory", { id, patch: { title: "updated", expected_version: 1 } }],
				["update_memory", { id, title: "flat update", importance: 1, expected_version: 2 }],
				["move_memory", { id, space: "sdk-space", expected_version: 3 }],
				["move_memory", { id, space: "kb" }],
				["delete_space", { slug: "sdk-space" }],
				["delete_memory", { id }],
			] as const;
			for (const [name, args] of calls) {
				const result = await client.callTool({ name, arguments: args });
				expect(result.isError, name).not.toBe(true);
				expect(result.structuredContent, name).toEqual(expect.any(Object));
			}
			const failure = await client.callTool({ name: "get_memory", arguments: { id } });
			expect(failure.isError).toBe(true);
			expect(failure.structuredContent).toMatchObject({ error: { code: "not_found" } });
		} finally {
			await client.close();
			await flush();
		}
	});
});
