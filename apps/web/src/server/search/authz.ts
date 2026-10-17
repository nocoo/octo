import type { ApiPrincipal } from "../auth/authorize";
import { visibleSpaceIds } from "../auth/authorize";
import { ApiError } from "../lib/errors";

export type AuthzContext = {
	keyId: string;
	visibleSpaceIds: string[] | "all";
};

export function searchAuthzFromPrincipal(principal: ApiPrincipal): AuthzContext {
	const vis = visibleSpaceIds(principal);
	return {
		keyId: principal.id,
		visibleSpaceIds: vis.kind === "all" ? "all" : [...vis.ids],
	};
}

export function requireSearchRead(principal: ApiPrincipal): void {
	if (!principal.ops.has("r")) {
		throw new ApiError("forbidden", "forbidden");
	}
}

export function canReadSpace(authz: AuthzContext, spaceId: string): boolean {
	if (authz.visibleSpaceIds === "all") {
		return true;
	}
	return authz.visibleSpaceIds.includes(spaceId);
}

export function intersectRequestedSpaces(
	authz: AuthzContext,
	requested: string[] | undefined,
	spaceSlugById: Map<string, string>,
): string[] {
	const visibleIds =
		authz.visibleSpaceIds === "all"
			? [...spaceSlugById.keys()]
			: authz.visibleSpaceIds.filter((id) => spaceSlugById.has(id));
	if (!requested || requested.length === 0) {
		return visibleIds;
	}
	const slugToId = new Map<string, string>();
	for (const [id, slug] of spaceSlugById) {
		slugToId.set(slug, id);
	}
	const wanted = requested
		.map((slug) => slugToId.get(slug))
		.filter((id): id is string => id !== undefined);
	return wanted.filter((id) => visibleIds.includes(id));
}
