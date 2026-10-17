import type { Env } from "../env";
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
	if (env.VEC) {
		return new CloudflareVectorStore(env.VEC);
	}
	return new D1BruteForceVectorStore(db, profileId, baseFilter);
}
