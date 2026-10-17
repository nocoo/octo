import type { Hono } from "hono";
import { batchGetRequestSchema } from "../../../lib/schema/batch-get";
import { searchRequestSchema } from "../../../lib/schema/search";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { parseStrict } from "../../lib/validate";
import { requireSearchRead, searchAuthzFromPrincipal } from "../../search/authz";
import { batchGetMemories } from "../../search/batch-get";
import { searchMemories } from "../../search/service";

async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		throw new ApiError("validation_failed", "invalid json body");
	}
}

export function mountV1SearchRoutes(
	app: Hono<{ Bindings: Env; Variables: AppVars }>,
	prefix = "/api/v1",
): void {
	app.post(`${prefix}/search`, async (c) => {
		const principal = c.get("apiKey");
		requireSearchRead(principal);
		const authz = searchAuthzFromPrincipal(principal);
		const body = parseStrict(searchRequestSchema, await readJsonBody(c));
		const result = await searchMemories(authz, body, { db: c.env.DB, env: c.env });
		return jsonOk(result);
	});

	app.post(`${prefix}/memories:batchGet`, async (c) => {
		const principal = c.get("apiKey");
		requireSearchRead(principal);
		const authz = searchAuthzFromPrincipal(principal);
		const input = await readJsonBody(c);
		if (
			input &&
			typeof input === "object" &&
			"ids" in input &&
			Array.isArray(input.ids) &&
			input.ids.length > 100
		) {
			throw new ApiError("payload_too_large", "batchGet accepts at most 100 ids");
		}
		const body = parseStrict(batchGetRequestSchema, input);
		const result = await batchGetMemories(c.env.DB, authz, body.ids);
		return jsonOk(result);
	});
}
