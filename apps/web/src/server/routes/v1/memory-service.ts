import type { Context } from "hono";
import type { AppVars, Env } from "../../env";
import { MemoryRepo } from "../../repo/memories";
import { MemoryService } from "../../services/memories";

export function memoryService(c: Context<{ Bindings: Env; Variables: AppVars }>): MemoryService {
	return new MemoryService(
		c.env.DB,
		undefined,
		undefined,
		undefined,
		new MemoryRepo(c.env.DB, (statements, mapError) => {
			c.get("writeStatements").push(...statements);
			c.set("writeError", mapError);
		}),
	);
}
