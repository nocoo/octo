import type { Context } from "hono";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { readJsonLimited } from "../lib/validate";
import { MemoryRepo } from "../repo/memories";
import { VersionRepo } from "../repo/versions";
import { authzFrom } from "../services/memories";

export async function authorizeMemoryRequest(
	c: Context<{ Bindings: Env; Variables: AppVars }>,
	outcome?: { status: number; body: string },
): Promise<void> {
	const path = c.req.path.replace(/\/$/, "");
	const method = c.req.method;
	const create = method === "POST" && path === "/api/v1/memories";
	const memory = /^\/api\/v1\/memories\/([^/]+)(\/rollback)?$/.exec(path);
	const restore = method === "POST" && /^\/api\/v1\/trash\/([^/]+)\/restore$/.exec(path);
	const update = memory && ((method === "PATCH" && !memory[2]) || (method === "POST" && memory[2]));
	const remove = memory && method === "DELETE" && !memory[2];
	if (!create && !update && !remove && !restore) return;
	const principal = c.get("apiKey");
	const authz = authzFrom(principal);
	const repo = new MemoryRepo(c.env.DB);
	if (create) {
		const payload = await readJsonLimited(c.req.raw.clone());
		if (
			!payload ||
			typeof payload !== "object" ||
			!("space" in payload) ||
			typeof payload.space !== "string"
		)
			return;
		const space = await repo.spaceBySlug(payload.space);
		if (
			space &&
			principal.autoOwnSpace &&
			principal.ops.has("w") &&
			payload.space === principal.name
		) {
			const owner = await c.env.DB.prepare("SELECT owner_key_id FROM spaces WHERE id = ?")
				.bind(space.id)
				.first<{ owner_key_id: string | null }>();
			if (owner?.owner_key_id !== principal.id)
				throw new ApiError("unprocessable", "own space name is taken");
		}
		if (space) authz.denyUnless("write", { spaceId: space.id });
		else if (
			!(principal.autoOwnSpace && payload.space === principal.name && principal.ops.has("w"))
		) {
			throw new ApiError(principal.ops.has("w") ? "not_found" : "forbidden", "not allowed");
		}
		if (!outcome || outcome.status >= 400) return;
		const saved = JSON.parse(outcome.body) as { id: string };
		const current = await repo.get(saved.id);
		if (!current || current.deleted_at !== null) throw new ApiError("not_found", "not found");
		authz.denyUnless("write", { spaceId: current.space_id, sourceKeyId: current.source_key_id });
		return;
	}
	const id = decodeURIComponent((restore ? restore[1] : memory?.[1]) ?? "");
	const current = await repo.get(id);
	if (!current || (update && current.deleted_at !== null))
		throw new ApiError("not_found", "not found");
	const target = { spaceId: current.space_id, sourceKeyId: current.source_key_id };
	if (!update) {
		authz.denyUnless("delete", target);
		return;
	}
	authz.denyUnless("update", target);
	const payload = await readJsonLimited(c.req.raw.clone());
	if (!payload || typeof payload !== "object") return;
	let destination: string | undefined;
	if (method === "PATCH" && "space" in payload && typeof payload.space === "string") {
		const space = await repo.spaceBySlug(payload.space);
		if (!space) throw new ApiError("not_found", "not found");
		destination = space.id;
	}
	if (method === "POST" && "to_version" in payload && typeof payload.to_version === "number") {
		destination = (await new VersionRepo(c.env.DB).get(id, payload.to_version, current))?.space_id;
	}
	if (destination && destination !== current.space_id)
		authz.denyUnless("move", { ...target, destSpaceId: destination });
}
