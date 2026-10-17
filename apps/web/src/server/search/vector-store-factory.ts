import { type Env, resourceEnv } from "../env";
import { ApiError } from "../lib/errors";
import { CloudflareVectorStore } from "../ports/vector/cloudflare";
import { D1BruteForceVectorStore } from "../ports/vector/d1-brute-force";
import type { VectorStore } from "../ports/vector/types";
import type { SqlFilter } from "./filters-sql";

export function createSearchVectorStore(
	env: Env,
	db: D1Database,
	profileId: string,
	baseFilter: SqlFilter,
): VectorStore {
	if (resourceEnv(env.RESOURCE_ENV) !== "production") {
		return new D1BruteForceVectorStore(db, profileId, baseFilter);
	}
	if (!env.VEC) throw new ApiError("unavailable", "VEC binding is required");
	return new CloudflareVectorStore(env.VEC);
}
