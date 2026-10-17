import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import type { MemoryService } from "../../services/memories";
import { createBatchRoutes } from "./batch";

export function createV1Routes(memoryService: MemoryService): Hono<{
	Bindings: Env;
	Variables: AppVars;
}> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.route("/", createBatchRoutes(memoryService));
	return app;
}
