import type { Env } from "../env";
import { backfillMemory } from "../settings/backfill";
import { synchronizeVectors } from "./vectors";

export async function runDerivedTasks(env: Env, now = Date.now()) {
	const jobs = await env.DB.prepare(`SELECT memory_id FROM vector_sync_jobs
		WHERE due_at <= ? AND lease_until <= ? ORDER BY due_at, memory_id LIMIT 50`)
		.bind(now, now)
		.all<{ memory_id: string }>();
	await Promise.all(jobs.results.map((job) => backfillMemory(env, job.memory_id)));
	return synchronizeVectors(env, { now });
}
