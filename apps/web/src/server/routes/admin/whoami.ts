import type { Context } from "hono";
import type { AppVars, Env } from "../../env";
import { fetchAuthorProfile } from "../../lib/author-profile";
import { jsonOk } from "../../lib/errors";

export async function whoamiResponse(
	c: Context<{ Bindings: Env; Variables: AppVars }>,
): Promise<Response> {
	const email = c.get("adminEmail");
	const fetcher =
		c.env.RESOURCE_ENV === "test"
			? (c.env.AUTHOR_PROFILE_FETCHER ?? {
					fetch: async () => Response.json({ name: null, avatar: null }),
				})
			: undefined;
	const profile = await fetchAuthorProfile(email, fetcher);
	return jsonOk({ email, actor: `admin:${email}`, ...profile }, 200, {
		"Cache-Control": "no-store",
	});
}
