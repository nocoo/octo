import type { ApiPrincipal } from "./auth/authorize";

export function testApiPrincipal(id = "kid"): ApiPrincipal {
	return {
		id,
		name: "test-agent",
		role: "admin",
		ops: new Set(["r", "w", "u", "d"]),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: [],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
	};
}
