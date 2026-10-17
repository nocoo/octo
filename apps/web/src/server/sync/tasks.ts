import type { Env } from "../env";
import { backfillMemory } from "../settings/backfill";
import { synchronizeVectors } from "./vectors";

export async function runDerivedTasks(env: Env, now = Date.now()) {
	return synchronizeVectors(env, {
		now,
		beforeSync: (memoryId) => backfillMemory(env, memoryId),
	});
}
