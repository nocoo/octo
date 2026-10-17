import { sqliteD1 } from "../../../../../../tests/fixtures/sqlite-d1";
import { execution } from "../../audit/__tests__/app";
import { mintApiKey } from "../../auth/api-key";
import type { Env } from "../../env";
import { createApp } from "../../index";

export const names = [
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

export const memoryInput = {
	space: "kb",
	title: "MCP contract",
	body: "A searchable octopus memory",
	type: "note",
	tags: ["mcp"],
};

export async function setup(ops = "r,w,u,d", spaceIds?: string[]) {
	const { db, sqlite } = sqliteD1();
	const key = await mintApiKey(db, "mcp-test-pepper", {
		name: "mcp-test",
		role: "custom",
		ops,
		scope: spaceIds ? "spaces" : "all",
		...(spaceIds ? { spaceIds } : {}),
	});
	const env = {
		DB: db,
		FILES: {} as R2Bucket,
		ASSETS: { fetch: async () => new Response("spa") } as unknown as Fetcher,
		API_KEY_PEPPER: "mcp-test-pepper",
		RESOURCE_ENV: "test",
	} satisfies Env;
	const app = createApp();
	const background = execution();
	const headers = {
		Authorization: `Bearer ${key.plaintext}`,
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		"MCP-Protocol-Version": "2025-11-25",
	};
	function request(body: unknown, extra: RequestInit = {}) {
		return app.request(
			"http://local/mcp",
			{
				method: "POST",
				headers,
				body: JSON.stringify(body),
				...extra,
			},
			env,
			background.ctx,
		);
	}
	function rpc(method: string, params?: unknown, extra?: RequestInit) {
		return request({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }, extra);
	}
	async function call(name: string, args: Record<string, unknown> = {}) {
		const response = await rpc("tools/call", { name, arguments: args });
		return (await response.json()) as {
			result: {
				isError?: boolean;
				content: { type: string; text: string }[];
				structuredContent: Record<string, unknown>;
			};
		};
	}
	return { db, sqlite, env, key, app, headers, request, rpc, call, ...background };
}
