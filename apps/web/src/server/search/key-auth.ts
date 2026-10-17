import { d1Results } from "../lib/d1";
import { ApiError } from "../lib/errors";
import { constantTimeEqual, hmacSecretHash, type ParsedApiKey } from "./api-key";
import type { AuthzContext } from "./authz";

type ApiKeyRow = {
	id: string;
	secret_hash: string;
	prev_secret_hash: string | null;
	prev_valid_until: number | null;
	scope: string;
	space_ids_json: string;
	revoked_at: number | null;
	expires_at: number | null;
	ops: string;
};

export async function resolveAuthz(
	db: D1Database,
	parsed: ParsedApiKey,
	pepper: string,
): Promise<AuthzContext> {
	const row = await db
		.prepare(
			"SELECT id, secret_hash, prev_secret_hash, prev_valid_until, scope, space_ids_json, revoked_at, expires_at, ops FROM api_keys WHERE id = ?",
		)
		.bind(parsed.keyId)
		.first<ApiKeyRow>();
	if (!row || row.revoked_at !== null) {
		throw new ApiError("unauthenticated", "unauthenticated");
	}
	const now = Date.now();
	if (row.expires_at !== null && row.expires_at <= now) {
		throw new ApiError("unauthenticated", "unauthenticated");
	}
	if (!row.ops.includes("r")) {
		throw new ApiError("forbidden", "forbidden");
	}
	const hash = await hmacSecretHash(pepper, parsed.secret);
	let ok = constantTimeEqual(hash, row.secret_hash);
	if (!ok && row.prev_secret_hash && row.prev_valid_until && row.prev_valid_until > now) {
		ok = constantTimeEqual(hash, row.prev_secret_hash);
	}
	if (!ok) {
		throw new ApiError("unauthenticated", "unauthenticated");
	}
	let visibleSpaceIds: string[] | "all" = "all";
	if (row.scope === "spaces") {
		visibleSpaceIds = JSON.parse(row.space_ids_json) as string[];
	} else if (row.scope === "own") {
		const owned = await db
			.prepare("SELECT id FROM spaces WHERE owner_key_id = ?")
			.bind(row.id)
			.all<{ id: string }>();
		visibleSpaceIds = d1Results(owned).map((r) => r.id);
	}
	return { keyId: row.id, visibleSpaceIds };
}
