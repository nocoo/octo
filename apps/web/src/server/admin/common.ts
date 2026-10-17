import type { Context } from "hono";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";

export function adminActor(c: Context<{ Bindings: Env; Variables: AppVars }>): string {
	const email = c.get("adminEmail");
	if (!email) throw new ApiError("unauthenticated", "unauthenticated");
	return `admin:${email}`;
}

export function conflict(message: string): ApiError {
	return new ApiError("version_conflict", message);
}

export async function commitAdminMutation(
	db: D1Database,
	statement: D1PreparedStatement,
	change: { entity: "api_key" | "space"; id: string; op: string; actor: string; at: number },
): Promise<void> {
	try {
		const results = await db.batch([
			statement,
			db
				.prepare(
					"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) SELECT ?, ?, ?, ?, NULL, ?, ? WHERE changes() > 0",
				)
				.bind(
					change.entity,
					change.id,
					change.entity === "space" ? change.id : null,
					change.op,
					change.actor,
					change.at,
				),
		]);
		if (results[0]?.meta.changes === 0) throw conflict("resource changed or is not empty");
	} catch (error) {
		if (
			error instanceof Error &&
			/UNIQUE constraint failed: (api_keys.name|spaces.slug)/.test(error.message)
		) {
			throw conflict("name or slug already exists");
		}
		throw error;
	}
}
