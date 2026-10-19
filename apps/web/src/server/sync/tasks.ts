import type { Env } from "../env";
import { backfillMemory } from "../settings/backfill";
import { synchronizeVectors } from "./vectors";

export async function runDerivedTasks(env: Env, now?: number, limit = 50) {
	return synchronizeVectors(env, {
		...(now === undefined ? {} : { now }),
		limit,
		beforeSync: (memoryId) => backfillMemory(env, memoryId),
	});
}
