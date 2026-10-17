import { Hono } from "hono";
import { adminActor } from "../../admin/common";
import {
	createSpace,
	deleteSpace,
	spaceCreateSchema,
	spacePatchSchema,
	updateSpace,
} from "../../admin/spaces";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { listEnvelope, serializeSpace } from "../../lib/http";
import { parseStrict, readJsonLimited } from "../../lib/validate";
import { SpaceRepo, type SpaceWithCount } from "../../repo/spaces";

async function loadSpace(db: D1Database, slug: string): Promise<SpaceWithCount> {
	const row = await new SpaceRepo(db).getVisibleBySlug(slug, { kind: "all" });
	if (!row) throw new ApiError("not_found", "space not found");
	return row;
}

export function adminSpacesRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (context, next) => {
		adminActor(context);
		await next();
	});
	app.get("/", async (context) =>
		jsonOk(
			listEnvelope(
				(await new SpaceRepo(context.env.DB).listVisible({ kind: "all" })).map(serializeSpace),
			),
		),
	);
	app.get("/:slug", async (context) =>
		jsonOk(serializeSpace(await loadSpace(context.env.DB, context.req.param("slug")))),
	);
	app.post("/", async (context) => {
		const input = parseStrict(spaceCreateSchema, await readJsonLimited(context.req.raw));
		const row = await createSpace(context.env.DB, input, adminActor(context));
		return jsonOk(serializeSpace({ ...row, memory_count: 0 }), 201);
	});
	app.patch("/:slug", async (context) => {
		const row = await loadSpace(context.env.DB, context.req.param("slug"));
		const patch = parseStrict(spacePatchSchema, await readJsonLimited(context.req.raw));
		return jsonOk(
			serializeSpace({
				...(await updateSpace(context.env.DB, row, patch, adminActor(context))),
				memory_count: row.memory_count,
			}),
		);
	});
	app.delete("/:slug", async (context) => {
		const row = await loadSpace(context.env.DB, context.req.param("slug"));
		await deleteSpace(context.env.DB, row, adminActor(context));
		return jsonOk({ id: row.id, slug: row.slug, deleted: true });
	});
	return app;
}
