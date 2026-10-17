import type { Context } from "hono";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";

export function whoamiResponse(c: Context<{ Bindings: Env; Variables: AppVars }>): Response {
	const email = c.get("adminEmail");
	return jsonOk({ email, actor: `admin:${email}` });
}
