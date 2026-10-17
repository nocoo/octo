import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	InitializeRequestSchema,
	JSONRPCMessageSchema,
	ListToolsRequestSchema,
	McpError,
	PingRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { APP_VERSION } from "../../lib/version";
import { bearerMiddleware } from "../auth/bearer";
import { allowedAdminOrigin } from "../auth/origin";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { readJsonLimited } from "../lib/validate";
import { callTool, createTools, type McpContext } from "./tools";

function rpcError(status: number, code: number, message: string): Response {
	return Response.json(
		{ jsonrpc: "2.0", id: null, error: { code, message } },
		{
			status,
			...(status === 405 ? { headers: { Allow: "POST" } } : {}),
		},
	);
}

async function handlePost(context: McpContext): Promise<Response> {
	let body: unknown;
	try {
		body = await readJsonLimited(context.req.raw);
	} catch (error) {
		if (error instanceof ApiError && error.code === "payload_too_large") {
			context.set("responseErrorCode", error.code);
			return rpcError(413, ErrorCode.InvalidRequest, "payload too large");
		}
		return rpcError(400, ErrorCode.ParseError, "invalid JSON");
	}
	const parsed = JSONRPCMessageSchema.safeParse(body);
	if (!parsed.success) return rpcError(400, ErrorCode.InvalidRequest, "invalid JSON-RPC request");
	if ("method" in parsed.data && "id" in parsed.data) {
		const method = parsed.data.method;
		const requestSchemas = [
			InitializeRequestSchema,
			ListToolsRequestSchema,
			CallToolRequestSchema,
			PingRequestSchema,
		];
		const schema = requestSchemas.find((candidate) => candidate.shape.method.value === method);
		if (
			schema &&
			(!schema.safeParse(parsed.data).success || parsed.data.params?.task !== undefined)
		) {
			context.set("responseErrorCode", "validation_failed");
			return Response.json({
				jsonrpc: "2.0",
				id: parsed.data.id,
				error: { code: ErrorCode.InvalidParams, message: "invalid request parameters" },
			});
		}
	}
	const server = new Server(
		{ name: "octo", version: APP_VERSION },
		{ capabilities: { tools: {} } },
	);
	const transport = new WebStandardStreamableHTTPServerTransport({
		enableJsonResponse: true,
	});
	const tools = createTools(context);
	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map((tool) => tool.definition),
	}));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const selected = tools.find((tool) => tool.definition.name === request.params.name);
		if (!selected) throw new McpError(ErrorCode.InvalidParams, "invalid tool request");
		return callTool(context, selected, request.params.arguments ?? {});
	});
	try {
		await server.connect(transport);
		const response = await transport.handleRequest(context.req.raw, { parsedBody: parsed.data });
		if (response.status === 202) return response;
		const result = (await response.clone().json()) as {
			error?: { code: number; message: string; data?: unknown };
		};
		if (result.error) {
			context.set(
				"responseErrorCode",
				result.error.code === ErrorCode.InternalError ? "internal" : "validation_failed",
			);
			const messages: Record<number, string> = {
				[ErrorCode.InvalidParams]: "invalid request parameters",
				[ErrorCode.MethodNotFound]: "method not found",
				[ErrorCode.InternalError]: "internal error",
			};
			if (messages[result.error.code]) {
				result.error = { code: result.error.code, message: messages[result.error.code] as string };
				return Response.json(result, { status: response.status, headers: response.headers });
			}
		}
		return response;
	} finally {
		await server.close();
	}
}

export function mcpRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", bearerMiddleware);
	app.use("*", async (context, next) => {
		const origin = context.req.header("Origin");
		if (origin !== undefined && origin !== allowedAdminOrigin(context.env))
			throw new ApiError("forbidden", "forbidden");
		await next();
	});
	const unsupported = () => rpcError(405, ErrorCode.ConnectionClosed, "method not allowed");
	app.post("/", handlePost);
	app.get("/", unsupported);
	app.delete("/", unsupported);
	app.all("/", unsupported);
	return app;
}
