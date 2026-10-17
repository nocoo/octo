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

async function listedIds(db: D1Database, key: AppVars["apiKey"]): Promise<string[]> {
	const vis = visibleSpaceIds(key);
	if (vis.kind === "ids") {
		return [...vis.ids];
	}
	const { results } = await db.prepare("SELECT id FROM spaces").all<{ id: string }>();
	return results.map((row) => row.id);
}

export function tagsRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/", async (c) => {
		const key = c.get("apiKey");
		if (!key.ops.has("r")) {
			throw new ApiError("forbidden", "forbidden");
		}
		const tags = await new TagRepo(c.env.DB).listWithCounts(await listedIds(c.env.DB, key));
		return jsonOk(listEnvelope(tags.map(serializeTag)));
	});

	app.post("/:name/rename", async (c) => {
		const key = c.get("apiKey");
		const allowed = authorize(key, "tag_global", {});
		if (!allowed.allow) {
			throw new ApiError("forbidden", "forbidden");
		}
		const body = parseStrict(renameSchema, await readJson(c.req.raw));
		const tag = await new TagRepo(c.env.DB).rename(
			c.req.param("name"),
			body.new_name,
			`key:${key.id}`,
		);
		return jsonOk(serializeTag(tag));
	});

	app.post("/:name/merge", async (c) => {
		const key = c.get("apiKey");
		const allowed = authorize(key, "tag_global", {});
		if (!allowed.allow) {
			throw new ApiError("forbidden", "forbidden");
		}
		const body = parseStrict(mergeSchema, await readJson(c.req.raw));
		const result = await new TagRepo(c.env.DB).merge(
			c.req.param("name"),
			body.into,
			`key:${key.id}`,
		);
		return jsonOk({
			from: serializeTag(result.from),
			into: serializeTag(result.into),
			memories: result.memories,
		});
	});

	return app;
}
