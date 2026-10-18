import { rollupUsage } from "../audit/usage";
import type { Env } from "../env";
import { cleanupExternalFiles } from "../purge/service";
import { backfillWordIndex } from "../search/word-backfill";
import { runDerivedTasks } from "../sync/tasks";
import { purgeIdempotencyOlderThan } from "./idempotency-repo";

export const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function runScheduledTasks(env: Env, now = Date.now()): Promise<{ purged: number }> {
	const [purged] = await Promise.all([
		purgeIdempotencyOlderThan(env.DB, now - IDEMPOTENCY_RETENTION_MS),
		rollupUsage(env.DB),
		runDerivedTasks(env, now),
		cleanupExternalFiles(env),
		backfillWordIndex(env.DB),
	]);
	return { purged };
}
