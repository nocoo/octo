import type { Env } from "../env";
import { backfillMemory } from "../settings/backfill";
import { synchronizeVectors } from "./vectors";

export async function runDerivedTasks(env: Env, now?: number) {
	return synchronizeVectors(env, {
		...(now === undefined ? {} : { now }),
		beforeSync: (memoryId) => backfillMemory(env, memoryId),
	});
}
