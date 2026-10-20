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

export function intersectRequestedSpaceIds(
	authz: AuthzContext,
	requestedIds: string[] | undefined,
	spaceSlugById: Map<string, string>,
): string[] {
	const visibleIds =
		authz.visibleSpaceIds === "all"
			? [...spaceSlugById.keys()]
			: authz.visibleSpaceIds.filter((id) => spaceSlugById.has(id));
	if (requestedIds === undefined) {
		return visibleIds;
	}
	const wanted = new Set(requestedIds);
	return visibleIds.filter((id) => wanted.has(id));
}
