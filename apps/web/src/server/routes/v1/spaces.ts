import { Hono, type MiddlewareHandler } from "hono";
import {
	spaceManagementCreateSchema,
	spaceManagementPatchSchema,
} from "../../../lib/schema/space-management";
import { visibleSpaceIds } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { serializeSpace } from "../../lib/http";
import { parseStrict, readJsonLimited } from "../../lib/validate";
import { SpaceRepo } from "../../repo/spaces";
import { listSpaces } from "../../services/catalog";
import {
	createManagedSpace,
	deleteManagedSpace,
	mapSpaceWriteError,
	requireSpaceAdmin,
	updateManagedSpace,
} from "../../services/space-management";

export const spaceWriteAuthorization: MiddlewareHandler<{
	Bindings: Env;
	Variables: AppVars;
}> = async (c, next) => {
	if (["POST", "PATCH", "DELETE"].includes(c.req.method)) requireSpaceAdmin(c.get("apiKey"));
	await next();
};

export function spacesRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", spaceWriteAuthorization);
	app.post("/", async (c) => {
		const input = parseStrict(spaceManagementCreateSchema, await readJsonLimited(c.req.raw));
		c.set("writeError", mapSpaceWriteError);
		return jsonOk(
			await createManagedSpace(c.env.DB, c.get("apiKey"), input, c.get("writeStatements")),
			201,
		);
	});
	app.patch("/:slug", async (c) => {
		const patch = parseStrict(spaceManagementPatchSchema, await readJsonLimited(c.req.raw));
		c.set("writeError", mapSpaceWriteError);
		return jsonOk(
			await updateManagedSpace(
				c.env.DB,
				c.get("apiKey"),
				c.req.param("slug"),
				patch,
				c.get("writeStatements"),
			),
		);
	});
	app.delete("/:slug", async (c) => {
		c.set("writeError", mapSpaceWriteError);
		return jsonOk(
			await deleteManagedSpace(
				c.env.DB,
				c.get("apiKey"),
				c.req.param("slug"),
				c.get("writeStatements"),
			),
		);
	});

	app.get("/", async (c) => {
		return jsonOk(await listSpaces(c.env.DB, c.get("apiKey")));
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
