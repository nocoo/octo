import { base } from "../fixtures/l2-batch";

export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_ACCEPT = "application/json, text/event-stream";

export type RpcResponse = {
	jsonrpc: string;
	id?: string | number | null;
	result?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
};

export type ToolResult = {
	content: Array<{ type: string; text: string }>;
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

export type McpRequestOptions = {
	accept?: string | null;
	contentType?: string | null;
	protocolVersion?: string | null;
	origin?: string;
	extraHeaders?: Record<string, string>;
};

export function rpcEnvelope(
	method: string,
	params?: unknown,
	id: string | number = crypto.randomUUID(),
) {
	return {
		jsonrpc: "2.0",
		id,
		method,
		...(params === undefined ? {} : { params }),
	};
}

export async function postMcp(
	token: string | null,
	body: unknown,
	options: McpRequestOptions = {},
): Promise<Response> {
	const headers = new Headers();
	const accept = options.accept === undefined ? MCP_ACCEPT : options.accept;
	const contentType = options.contentType === undefined ? "application/json" : options.contentType;
	const protocolVersion =
		options.protocolVersion === undefined ? MCP_PROTOCOL_VERSION : options.protocolVersion;
	if (accept !== null) headers.set("Accept", accept);
	if (contentType !== null) headers.set("Content-Type", contentType);
	if (protocolVersion !== null) headers.set("MCP-Protocol-Version", protocolVersion);
	if (token !== null) headers.set("Authorization", `Bearer ${token}`);
	if (options.origin !== undefined) headers.set("Origin", options.origin);
	for (const [name, value] of Object.entries(options.extraHeaders ?? {})) headers.set(name, value);
	return fetch(`${base}/mcp`, {
		method: "POST",
		headers,
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

export function toolRequest(
	name: string,
	args?: Record<string, unknown>,
	id: string | number = crypto.randomUUID(),
) {
	return rpcEnvelope(
		"tools/call",
		{ name, ...(args === undefined ? {} : { arguments: args }) },
		id,
	);
}

export async function callTool(
	token: string | null,
	name: string,
	args?: Record<string, unknown>,
	options: McpRequestOptions & { id?: string | number } = {},
): Promise<Response> {
	return postMcp(token, toolRequest(name, args, options.id), options);
}
