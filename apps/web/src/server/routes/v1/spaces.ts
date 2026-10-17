import { Hono } from "hono";
import { visibleSpaceIds } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { listEnvelope, serializeSpace } from "../../lib/http";
import { SpaceRepo } from "../../repo/spaces";

export function spacesRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/", async (c) => {
		const key = c.get("apiKey");
		if (!key.ops.has("r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const spaces = await new SpaceRepo(c.env.DB).listVisible(visibleSpaceIds(key));
		return jsonOk(listEnvelope(spaces.map(serializeSpace)));
	});

	app.get("/:slug", async (c) => {
		const key = c.get("apiKey");
		if (!key.ops.has("r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const space = await new SpaceRepo(c.env.DB).getVisibleBySlug(
			c.req.param("slug"),
			visibleSpaceIds(key),
		);
		if (!space) {
			throw new ApiError("not_found", "not found");
		}
		return jsonOk(serializeSpace(space));
	});

	return app;
}
