import { afterEach, describe, expect, it, vi } from "vitest";
import { JSON_BODY_MAX_BYTES } from "../lib/validate";
import { names, setup } from "./__tests__/app";

afterEach(() => vi.restoreAllMocks());

describe("stateless MCP transport", () => {
	it("initializes, accepts notifications and lists schemas without sessions", async () => {
		const { rpc, request, flush } = await setup();
		const initialized = await rpc("initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "test-bot", version: "1" },
		});
		expect(initialized.status).toBe(200);
		expect(initialized.headers.get("mcp-session-id")).toBeNull();
		expect(await initialized.json()).toMatchObject({
			id: 1,
			result: {
				protocolVersion: "2025-11-25",
				capabilities: { tools: {} },
				serverInfo: { name: "octo" },
			},
		});
		const notification = await request({ jsonrpc: "2.0", method: "notifications/initialized" });
		expect(notification.status).toBe(202);
		expect(await notification.text()).toBe("");
		const responses = await Promise.all([rpc("tools/list"), rpc("tools/list")]);
		for (const response of responses) {
			expect(response.headers.get("mcp-session-id")).toBeNull();
			const body = (await response.json()) as {
				result: { tools: { name: string; inputSchema: object; outputSchema: object }[] };
			};
			expect(body.result.tools.map((tool) => tool.name)).toEqual(names);
			for (const tool of body.result.tools) {
				expect(tool.inputSchema).toMatchObject({ type: "object" });
				if (tool.name === "update_memory") {
					expect(tool.inputSchema).toMatchObject({
						anyOf: [
							{
								additionalProperties: false,
								required: ["expected_version", "id"],
								properties: {
									importance: { minimum: 0, maximum: 1 },
									expected_version: { type: "integer", exclusiveMinimum: 0 },
								},
							},
							{
								additionalProperties: false,
								required: ["id", "patch"],
								properties: {
									patch: { additionalProperties: false, required: ["expected_version"] },
								},
							},
						],
					});
				} else {
					expect(tool.inputSchema).toMatchObject({ additionalProperties: false });
				}
				expect(tool.outputSchema).toMatchObject({ type: "object" });
			}
		}
		await flush();
	});

	it.each(["GET", "DELETE", "PUT", "PATCH", "OPTIONS", "HEAD"])(
		"authenticates then rejects %s",
		async (method) => {
			const { app, env, headers, ctx, flush } = await setup();
			const missing = await app.request("http://local/mcp", { method }, env, ctx);
			expect(missing.status).toBe(401);
			const denied = await app.request("http://local/mcp", { method, headers }, env, ctx);
			expect(denied.status).toBe(405);
			expect(denied.headers.get("allow")).toBe("POST");
			await flush();
		},
	);

	it.each(["", "Bearer bad", "Basic ignored"])(
		"rejects bad credentials %s",
		async (authorization) => {
			const { rpc, headers, flush } = await setup();
			const response = await rpc("tools/list", undefined, {
				headers: { ...headers, Authorization: authorization },
			});
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
			await flush();
		},
	);

	it.each(["https://evil.example", "null", "https://octo.hexly.ai.evil.example"])(
		"rejects foreign Origin %s",
		async (origin) => {
			const { rpc, headers, flush } = await setup();
			const response = await rpc("tools/list", undefined, {
				headers: { ...headers, Origin: origin },
			});
			expect(response.status).toBe(403);
			await flush();
		},
	);

	it("allows only the fixed origin for each environment", async () => {
		const { rpc, headers, env, flush } = await setup();
		expect(
			(
				await rpc("tools/list", undefined, {
					headers: { ...headers, Origin: "https://octo.hexly.ai" },
				})
			).status,
		).toBe(200);
		env.RESOURCE_ENV = "development";
		expect(
			(
				await rpc("tools/list", undefined, {
					headers: { ...headers, Origin: "https://octo.dev.hexly.ai" },
				})
			).status,
		).toBe(200);
		await flush();
	});

	it.each([
		["Accept", "application/json", 406],
		["Content-Type", "text/plain", 415],
		["MCP-Protocol-Version", "1900-01-01", 400],
	] as const)("rejects invalid %s", async (header, value, status) => {
		const { rpc, headers, flush } = await setup();
		const response = await rpc("tools/list", undefined, {
			headers: { ...headers, [header]: value },
		});
		expect(response.status).toBe(status);
		expect(await response.json()).toHaveProperty("error.code");
		await flush();
	});

	it.each([
		null,
		[],
		[{ jsonrpc: "2.0", id: 1, method: "tools/list" }],
		{},
		{ jsonrpc: "2.0", id: false, method: "tools/list" },
	])("rejects invalid envelope %j", async (body) => {
		const { request, flush } = await setup();
		const response = await request(body);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32600 } });
		await flush();
	});

	it("bounds parsing and reports malformed JSON", async () => {
		const { rpc, headers, flush } = await setup();
		const malformed = await rpc("tools/list", undefined, { body: "{" });
		expect(malformed.status).toBe(400);
		expect(await malformed.json()).toMatchObject({ error: { code: -32700 } });
		for (const extra of [
			{ headers: { ...headers, "Content-Length": String(JSON_BODY_MAX_BYTES + 1) } },
			{ body: " ".repeat(JSON_BODY_MAX_BYTES + 1) },
		]) {
			const response = await rpc("tools/list", undefined, extra);
			expect(response.status).toBe(413);
		}
		await flush();
	});

	it("maps unknown methods and invalid call params without leaking inputs", async () => {
		const { rpc, flush } = await setup();
		for (const [method, params, code] of [
			["private-method", {}, -32601],
			["tools/call", { name: "secret-tool" }, -32602],
			["tools/call", { name: 42 }, -32602],
			["tools/call", { name: "create_memory", task: {} }, -32602],
		] as const) {
			const response = await rpc(method, params);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ error: { code } });
		}
		await flush();
	});
});
