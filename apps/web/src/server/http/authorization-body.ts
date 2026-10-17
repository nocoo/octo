import type { Context } from "hono";
import type { AppVars, Env } from "../env";
import { JSON_BODY_MAX_BYTES, readJsonLimited } from "../lib/validate";

const bodies = new WeakMap<Context<{ Bindings: Env; Variables: AppVars }>, Promise<unknown>>();

export function readAuthorizationBody(
	context: Context<{ Bindings: Env; Variables: AppVars }>,
	maxBytes = JSON_BODY_MAX_BYTES,
): Promise<unknown> {
	let body = bodies.get(context);
	if (!body) {
		body = readJsonLimited(context.req.raw.clone(), maxBytes);
		bodies.set(context, body);
	}
	return body;
}
