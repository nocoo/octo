import type { Context } from "hono";
import { visibleSpaceIds } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";

export async function meResponse(
	c: Context<{ Bindings: Env; Variables: AppVars }>,
): Promise<Response> {
	const key = c.get("apiKey");
	const vis = visibleSpaceIds(key);
	let spaces: Array<{ id: string; slug: string; name: string }>;
	if (vis.kind === "all") {
		const result = await c.env.DB.prepare("SELECT id, slug, name FROM spaces ORDER BY slug").all<{
			id: string;
			slug: string;
			name: string;
		}>();
		spaces = result.results;
	} else if (vis.ids.length === 0) {
		spaces = [];
	} else {
		const placeholders = vis.ids.map(() => "?").join(",");
		const result = await c.env.DB.prepare(
			`SELECT id, slug, name FROM spaces WHERE id IN (${placeholders}) ORDER BY slug`,
		)
			.bind(...vis.ids)
			.all<{ id: string; slug: string; name: string }>();
		spaces = result.results;
	}
	return jsonOk({
		id: key.id,
		name: key.name,
		role: key.role,
		ops: [...key.ops].sort(),
		scope: key.scope,
		spaces,
		own_entries_only: key.ownEntriesOnly,
		auto_own_space: key.autoOwnSpace,
		expires_at: key.expiresAt == null ? null : new Date(key.expiresAt).toISOString(),
	});
}
