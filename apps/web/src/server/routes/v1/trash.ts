import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";
import { parseLimit } from "../../repo/memories-cursor";
import { authzFrom, MemoryService, parseInclude } from "../../services/memories";
import { filtersFromQuery } from "./memories";
import { memoryService } from "./memory-service";

export function trashRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/", async (c) => {
		const url = new URL(c.req.url);
		const listed = await new MemoryService(c.env.DB).list(authzFrom(c.get("apiKey")), {
			filters: filtersFromQuery(url),
			include: parseInclude("trashed"),
			cursor: url.searchParams.get("cursor") ?? undefined,
			limit: parseLimit(url.searchParams.get("limit")),
			trashedOnly: true,
		});
		return jsonOk(listed);
	});

	app.post("/:id/restore", async (c) => {
		const item = await memoryService(c).restore(authzFrom(c.get("apiKey")), c.req.param("id"));
		return jsonOk(item);
	});

	return app;
}
