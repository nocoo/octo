import type { Context } from "hono";
import type { AppVars, Env } from "../../env";
import { fetchAuthorProfile } from "../../lib/author-profile";
import { jsonOk } from "../../lib/errors";

export async function whoamiResponse(
	c: Context<{ Bindings: Env; Variables: AppVars }>,
): Promise<Response> {
	const email = c.get("adminEmail");
	const profile =
		c.env.RESOURCE_ENV === "test" ? { name: null, avatar: null } : await fetchAuthorProfile(email);
	return jsonOk({ email, actor: `admin:${email}`, ...profile });
}
