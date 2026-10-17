import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";
import { parseLimit } from "../../repo/memories-cursor";
import { authzFrom, MemoryService } from "../../services/memories";

function spacesParam(url: URL): string[] | undefined {
	const raw = url.searchParams.get("spaces");
	if (raw == null || raw === "") {
		return undefined;
	}
	const parts = raw
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	return parts.length > 0 ? parts : undefined;
}

export function changesRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/head", async (c) => {
		const url = new URL(c.req.url);
		const item = await new MemoryService(c.env.DB).changesHead(
			authzFrom(c.get("apiKey")),
			spacesParam(url),
		);
		return jsonOk(item);
	});

	app.get("/", async (c) => {
		const url = new URL(c.req.url);
		const listed = await new MemoryService(c.env.DB).listChanges(authzFrom(c.get("apiKey")), {
			cursor: url.searchParams.get("cursor") ?? undefined,
			limit: parseLimit(url.searchParams.get("limit")),
			spaces: spacesParam(url),
		});
		return jsonOk(listed);
	});

	return app;
}
