import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Context } from "hono";
import { z } from "zod";
import { batchGetRequestSchema } from "../../lib/schema/batch-get";
import { memoryCreateSchema } from "../../lib/schema/memory";
import { searchRequestSchema } from "../../lib/schema/search";
import type { AppVars, Env } from "../env";
import { ApiError, errorEnvelope } from "../lib/errors";
import { parseStrict } from "../lib/validate";
import { memoryService } from "../routes/v1/memory-service";
import { requireSearchRead, searchAuthzFromPrincipal } from "../search/authz";
import { batchGetMemories } from "../search/batch-get";
import { searchMemories } from "../search/service";
import { listSpaces, listTags } from "../services/catalog";
import { authzFrom, MemoryService } from "../services/memories";
import { runDerivedTasks } from "../sync/tasks";
import {
	batchGetOutput,
	changesInput,
	changesOutput,
	deleteOutput,
	emptyInput,
	errorOutput,
	getInput,
	idInput,
	memoryOutput,
	searchOutput,
	spacesOutput,
	tagsOutput,
	updateInput,
} from "./schemas";

export type McpContext = Context<{ Bindings: Env; Variables: AppVars }>;

function tool<Input>(
	name: string,
	description: string,
	input: z.ZodType<Input>,
	output: z.ZodType,
	execute: (input: Input) => Promise<Record<string, unknown>>,
) {
	return {
		definition: {
			name,
			description,
			inputSchema: z.toJSONSchema(input, { io: "input" }) as Tool["inputSchema"],
			outputSchema: {
				...z.toJSONSchema(z.union([output, errorOutput])),
				type: "object",
			} as NonNullable<Tool["outputSchema"]>,
		} satisfies Tool,
		execute: (args: unknown) => execute(parseStrict(input, args)),
	};
}

export function createTools(context: McpContext) {
	const principal = context.get("apiKey");
	const authz = authzFrom(principal);
	const service = new MemoryService(context.env.DB);
	return [
		tool(
			"search",
			"Search visible memories using v1 text or vector search.",
			searchRequestSchema,
			searchOutput,
			async (input) => {
				requireSearchRead(principal);
				return searchMemories(searchAuthzFromPrincipal(principal), input, {
					db: context.env.DB,
					env: context.env,
				});
			},
		),
		tool(
			"get_memory",
			"Read one visible memory, optionally including metadata or trash.",
			getInput,
			memoryOutput,
			(input) => service.get(authz, input.id, new Set(input.include)),
		),
		tool(
			"batch_get",
			"Read up to 100 memories; inaccessible IDs are reported as missing.",
			batchGetRequestSchema,
			batchGetOutput,
			async (input) => {
				requireSearchRead(principal);
				return batchGetMemories(context.env.DB, searchAuthzFromPrincipal(principal), input.ids);
			},
		),
		tool(
			"create_memory",
			"Create a memory in an authorized space.",
			memoryCreateSchema,
			memoryOutput,
			(input) => memoryService(context).create(authz, input),
		),
		tool(
			"update_memory",
			"Update a memory using the required expected_version.",
			updateInput,
			memoryOutput,
			(input) => memoryService(context).patch(authz, input.id, input.patch, undefined),
		),
		tool(
			"delete_memory",
			"Move a memory to trash; never permanently delete.",
			idInput,
			deleteOutput,
			(input) => memoryService(context).remove(authz, input.id),
		),
		tool(
			"list_changes",
			"Read the visible change feed with an opaque v1 cursor.",
			changesInput,
			changesOutput,
			(input) => service.listChanges(authz, { ...input, limit: input.limit ?? 50 }),
		),
		tool(
			"list_tags",
			"List tags with counts restricted to visible spaces.",
			emptyInput,
			tagsOutput,
			() => listTags(context.env.DB, principal),
		),
		tool(
			"list_spaces",
			"List visible spaces and their memory counts.",
			emptyInput,
			spacesOutput,
			() => listSpaces(context.env.DB, principal),
		),
	];
}

function content(data: Record<string, unknown>): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

async function commit(context: McpContext): Promise<void> {
	const statements = context.get("writeStatements");
	if (!statements.length) return;
	try {
		await context.env.DB.batch(statements);
	} catch (error) {
		let mapped: ApiError | undefined;
		try {
			mapped = await context.get("writeError")?.(error);
		} catch {}
		throw mapped ?? new ApiError("unavailable", "write transaction failed");
	}
	try {
		context.executionCtx.waitUntil(
			runDerivedTasks(context.env).catch(() => {
				console.error("derived_work_failed");
			}),
		);
	} catch {}
}

export async function callTool(
	context: McpContext,
	selected: ReturnType<typeof createTools>[number],
	args: unknown,
): Promise<CallToolResult> {
	context.set("writeStatements", []);
	try {
		const data = await selected.execute(args);
		await commit(context);
		return content(data);
	} catch (error) {
		const known = error instanceof ApiError ? error : new ApiError("internal", "internal error");
		context.set("responseErrorCode", known.code);
		return {
			...content(errorEnvelope(known.code, known.message, context.get("requestId"), known.details)),
			isError: true,
		};
	}
}
