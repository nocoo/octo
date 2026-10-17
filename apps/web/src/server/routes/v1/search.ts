import type { Hono } from "hono";
import { batchGetRequestSchema } from "../../../lib/schema/batch-get";
import { searchRequestSchema } from "../../../lib/schema/search";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { parseStrict } from "../../lib/validate";
import { parseBearerToken } from "../../search/api-key";
import type { AuthzContext } from "../../search/authz";
import { batchGetMemories } from "../../search/batch-get";
import { resolveAuthz } from "../../search/key-auth";
import { searchMemories } from "../../search/service";

async function requireAuthz(c: {
	env: Env;
	req: { header: (name: string) => string | undefined };
}): Promise<AuthzContext> {
	const parsed = parseBearerToken(c.req.header("Authorization"));
	if (!parsed) {
		throw new ApiError("unauthenticated", "unauthenticated");
	}
	const pepper = c.env.API_KEY_PEPPER;
	if (!pepper) {
		throw new ApiError("internal", "internal error");
	}
	return resolveAuthz(c.env.DB, parsed, pepper);
}

export function mountV1SearchRoutes(app: Hono<{ Bindings: Env; Variables: AppVars }>): void {
	app.post("/api/v1/search", async (c) => {
		const authz = await requireAuthz(c);
		const body = parseStrict(searchRequestSchema, await c.req.json());
		const result = await searchMemories(authz, body, { db: c.env.DB });
		return jsonOk(result);
	});

	app.post("/api/v1/memories:batchGet", async (c) => {
		const authz = await requireAuthz(c);
		const body = parseStrict(batchGetRequestSchema, await c.req.json());
		const result = await batchGetMemories(c.env.DB, authz, body.ids);
		return jsonOk(result);
	});
}
