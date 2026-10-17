import { Hono } from "hono";
import { visibleSpaceIds } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { SpaceRepo } from "../../repo/spaces";

async function listedIds(db: D1Database, key: AppVars["apiKey"]): Promise<string[]> {
	const vis = visibleSpaceIds(key);
	if (vis.kind === "ids") {
		return [...vis.ids];
	}
	const { results } = await db.prepare("SELECT id FROM spaces").all<{ id: string }>();
	return results.map((row) => row.id);
}

export function spacesRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/", async (c) => {
		const key = c.get("apiKey");
		if (!key.ops.has("r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const spaces = await new SpaceRepo(c.env.DB).listVisible(await listedIds(c.env.DB, key));
		return jsonOk({ spaces });
	});

	app.get("/:slug", async (c) => {
		const key = c.get("apiKey");
		if (!key.ops.has("r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const space = await new SpaceRepo(c.env.DB).getVisibleBySlug(
			c.req.param("slug"),
			await listedIds(c.env.DB, key),
		);
		if (!space) {
			throw new ApiError("not_found", "not found");
		}
		return jsonOk({ space });
	});

	return app;
}
