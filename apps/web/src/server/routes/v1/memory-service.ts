import type { Context } from "hono";
import type { AppVars, Env } from "../../env";
import { MemoryRepo } from "../../repo/memories";
import { TagRepo } from "../../repo/tags";
import { MemoryService } from "../../services/memories";

export function memoryService(
	context: Context<{ Bindings: Env; Variables: AppVars }>,
): MemoryService {
	return new MemoryService(
		context.env.DB,
		new TagRepo(context.env.DB, undefined, undefined, context.get("writeStatements")),
		undefined,
		undefined,
		new MemoryRepo(context.env.DB, (statements, mapError) => {
			context.get("writeStatements").push(...statements);
			context.set("writeError", mapError);
		}),
		undefined,
		undefined,
		context.get("writeStatements"),
	);
}
