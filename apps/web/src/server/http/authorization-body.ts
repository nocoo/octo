import type { Context } from "hono";
import type { AppVars, Env } from "../env";
import { JSON_BODY_MAX_BYTES, readJsonLimited } from "../lib/validate";

const bodies = new WeakMap<Context<{ Bindings: Env; Variables: AppVars }>, Promise<unknown>>();

export function readAuthorizationBody(
	c: Context<{ Bindings: Env; Variables: AppVars }>,
	maxBytes = JSON_BODY_MAX_BYTES,
): Promise<unknown> {
	let body = bodies.get(c);
	if (!body) {
		body = readJsonLimited(c.req.raw.clone(), maxBytes);
		bodies.set(c, body);
	}
	return body;
}
