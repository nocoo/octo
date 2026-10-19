import type { Env } from "../env";
import { backfillMemories } from "../settings/backfill";
import { synchronizeVectors } from "./vectors";

export async function runDerivedTasks(
	env: Env,
	now?: number,
	memoryIds?: string[],
	limit?: number,
) {
	return synchronizeVectors(env, {
		...(now === undefined ? {} : { now }),
		...(memoryIds === undefined ? {} : { memoryIds }),
		...(limit === undefined ? {} : { limit }),
		beforeSyncBatch: (ids) => backfillMemories(env, ids),
	});
}
