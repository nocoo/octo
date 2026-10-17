import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { isoUtc, listEnvelope } from "../../lib/http";

type ProfileRow = {
	id: string;
	model: string;
	dims: number;
	metric: string;
	active: number;
	created_at: number;
};

export function embeddingProfilesRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.get("/", async (context) => {
		if (!context.get("apiKey").ops.has("r")) throw new ApiError("forbidden", "forbidden");
		const result = await context.env.DB.prepare(
			"SELECT id, model, dims, metric, active, created_at FROM embedding_profiles ORDER BY id",
		).all<ProfileRow>();
		const items = result.results.map((row) => ({
			...row,
			active: row.active === 1,
			created_at: isoUtc(row.created_at),
		}));
		return jsonOk({
			...listEnvelope(items),
			active_profile: items.find((row) => row.active)?.id ?? null,
		});
	});
	return app;
}
