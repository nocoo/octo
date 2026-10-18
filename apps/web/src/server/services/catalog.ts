import { type ApiPrincipal, visibleSpaceIds } from "../auth/authorize";
import { ApiError } from "../lib/errors";
import { listEnvelope, serializeSpace, serializeTag } from "../lib/http";
import { SpaceRepo } from "../repo/spaces";
import { TagRepo } from "../repo/tags";

function requireRead(principal: ApiPrincipal): void {
	if (!principal.ops.has("r")) throw new ApiError("forbidden", "forbidden");
}

export async function listTags(db: D1Database, principal: ApiPrincipal) {
	requireRead(principal);
	const tags = await new TagRepo(db).listWithCounts(visibleSpaceIds(principal));
	return listEnvelope(tags.filter((tag) => principal.actor || tag.use_count > 0).map(serializeTag));
}

export async function listSpaces(db: D1Database, principal: ApiPrincipal) {
	requireRead(principal);
	const spaces = await new SpaceRepo(db).listVisible(visibleSpaceIds(principal));
	return listEnvelope(spaces.map(serializeSpace));
}
