import { Hono } from "hono";
import { z } from "zod";
import { authorize, visibleSpaceIds } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { listEnvelope, serializeTag } from "../../lib/http";
import { parseStrict, readJson } from "../../lib/validate";
import { TagRepo } from "../../repo/tags";

const renameSchema = z.strictObject({ new_name: z.string().min(1) });
const mergeSchema = z.strictObject({ into: z.string().min(1) });

export function tagsRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/", async (c) => {
		const key = c.get("apiKey");
		if (!key.ops.has("r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const tags = await new TagRepo(c.env.DB).listWithCounts(visibleSpaceIds(key));
		return jsonOk(listEnvelope(tags.map(serializeTag)));
	});

	app.post("/:name/rename", async (c) => {
		const key = c.get("apiKey");
		const allowed = authorize(key, "tag_global", {});
		if (!allowed.allow) {
			throw new ApiError("forbidden", "forbidden");
		}
		const body = parseStrict(renameSchema, await readJson(c.req.raw));
		const write = await new TagRepo(c.env.DB).rename(
			c.req.param("name"),
			body.new_name,
			`key:${key.id}`,
		);
		c.get("writeStatements").push(...write.statements);
		c.set("writeError", write.mapError);
		return jsonOk(serializeTag(write.value));
	});

	app.post("/:name/merge", async (c) => {
		const key = c.get("apiKey");
		const allowed = authorize(key, "tag_global", {});
		if (!allowed.allow) {
			throw new ApiError("forbidden", "forbidden");
		}
		const body = parseStrict(mergeSchema, await readJson(c.req.raw));
		const write = await new TagRepo(c.env.DB).merge(
			c.req.param("name"),
			body.into,
			`key:${key.id}`,
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
