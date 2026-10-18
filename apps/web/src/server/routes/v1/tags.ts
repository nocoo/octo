import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { authorize, principalActor } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { serializeTag } from "../../lib/http";
import { parseStrict, readJson } from "../../lib/validate";
import { TagRepo } from "../../repo/tags";
import { listTags } from "../../services/catalog";

const renameSchema = z.strictObject({ new_name: z.string().min(1) });
const mergeSchema = z.strictObject({ into: z.string().min(1) });

export const tagWriteAuthorization: MiddlewareHandler<{
	Bindings: Env;
	Variables: AppVars;
}> = async (c, next) => {
	if (
		(c.req.method === "POST" || c.req.method === "DELETE") &&
		!authorize(c.get("apiKey"), "tag_global", {}).allow
	) {
		throw new ApiError("forbidden", "forbidden");
	}
	await next();
};

export function tagsRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/", async (c) => {
		return jsonOk(await listTags(c.env.DB, c.get("apiKey")));
	});

	app.delete("/:name", async (c) => {
		const write = await new TagRepo(c.env.DB).remove(c.req.param("name"));
		c.get("writeStatements").push(...write.statements);
		c.set("writeError", write.mapError);
		return jsonOk(write.value);
	});

	app.post("/:name/rename", async (c) => {
		const key = c.get("apiKey");
		const body = parseStrict(renameSchema, await readJson(c.req.raw));
		const write = await new TagRepo(c.env.DB).rename(
			c.req.param("name"),
			body.new_name,
			principalActor(key),
		);
		c.get("writeStatements").push(...write.statements);
		c.set("writeError", write.mapError);
		return jsonOk(serializeTag(write.value));
	});

	app.post("/:name/merge", async (c) => {
		const key = c.get("apiKey");
		const body = parseStrict(mergeSchema, await readJson(c.req.raw));
		const write = await new TagRepo(c.env.DB).merge(
			c.req.param("name"),
			body.into,
			principalActor(key),
		);
		c.get("writeStatements").push(...write.statements);
		c.set("writeError", write.mapError);
		const result = write.value;
		return jsonOk({
			from: serializeTag(result.from),
			into: serializeTag(result.into),
			memories: result.memories,
		});
	});

	return app;
}
