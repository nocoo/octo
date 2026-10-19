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
import {
	createManagedSpace,
	deleteManagedSpace,
	updateManagedSpace,
} from "../services/space-management";
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
	moveInput,
	searchOutput,
	spaceCreateInput,
	spaceDeleteOutput,
	spaceIdInput,
	spaceOutput,
	spacesOutput,
	spaceUpdateInput,
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
			inputSchema: {
				...z.toJSONSchema(input, { io: "input" }),
				type: "object",
			} as Tool["inputSchema"],
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
			"Update a memory with flat fields or a nested patch, never both; expected_version is required.",
			updateInput,
			memoryOutput,
			({ id, ...patch }) => memoryService(context).patch(authz, id, patch, undefined),
		),
		tool(
			"move_memory",
			"Move a live memory between spaces authorized for update, optionally checking its version.",
			moveInput,
			memoryOutput,
			({ id, ...input }) => memoryService(context).move(authz, id, input),
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
		tool(
			"create_space",
			"Create a space with an admin-role API key; no ownership management.",
			spaceCreateInput,
			spaceOutput,
			async (input) => {
				const result = await createManagedSpace(context.env.DB, principal, input);
				context.set("mcpWrite", true);
				return result;
			},
		),
		tool(
			"update_space",
			"Update a space name or description with an admin-role API key; its slug is immutable.",
			spaceUpdateInput,
			spaceOutput,
			async ({ slug, ...patch }) => {
				const result = await updateManagedSpace(context.env.DB, principal, slug, patch);
				context.set("mcpWrite", true);
				return result;
			},
		),
		tool(
			"delete_space",
			"Delete an empty space with an admin-role API key; trash also prevents deletion.",
			spaceIdInput,
			spaceDeleteOutput,
			async ({ slug }) => {
				const result = await deleteManagedSpace(context.env.DB, principal, slug);
				context.set("mcpWrite", true);
				return result;
			},
		),
	];
}

function content(data: Record<string, unknown>): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

async function commit(context: McpContext, skipEmbedding: boolean): Promise<void> {
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
	context.set("mcpWrite", true);
	try {
		context.executionCtx.waitUntil(
			runDerivedTasks(
				context.env,
				undefined,
				[...new Set(context.get("vectorMemoryIds") ?? [])],
				undefined,
				skipEmbedding,
			).catch(() => {
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
	context.set("vectorMemoryIds", []);
	try {
		const data = await selected.execute(args);
		await commit(context, selected.definition.name === "move_memory");
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
