import type { Env } from "../env";
import { purgeIdempotencyOlderThan } from "./idempotency-repo";

export const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function runScheduledTasks(env: Env, now = Date.now()): Promise<{ purged: number }> {
	const purged = await purgeIdempotencyOlderThan(env.DB, now - IDEMPOTENCY_RETENTION_MS);
	return { purged };
}
