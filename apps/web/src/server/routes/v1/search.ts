import type { Hono } from "hono";
import { batchGetRequestSchema } from "../../../lib/schema/batch-get";
import { searchRequestSchema } from "../../../lib/schema/search";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";
import { parseStrict } from "../../lib/validate";
import { requireSearchRead, searchAuthzFromPrincipal } from "../../search/authz";
import { batchGetMemories } from "../../search/batch-get";
import { searchMemories } from "../../search/service";

export function mountV1SearchRoutes(app: Hono<{ Bindings: Env; Variables: AppVars }>): void {
	app.post("/api/v1/search", async (c) => {
		const principal = c.get("apiKey");
		requireSearchRead(principal);
		const authz = searchAuthzFromPrincipal(principal);
		const body = parseStrict(searchRequestSchema, await c.req.json());
		const result = await searchMemories(authz, body, { db: c.env.DB });
		return jsonOk(result);
	});

	app.post("/api/v1/memories:batchGet", async (c) => {
		const principal = c.get("apiKey");
		requireSearchRead(principal);
		const authz = searchAuthzFromPrincipal(principal);
		const body = parseStrict(batchGetRequestSchema, await c.req.json());
		const result = await batchGetMemories(c.env.DB, authz, body.ids);
		return jsonOk(result);
	});
}
