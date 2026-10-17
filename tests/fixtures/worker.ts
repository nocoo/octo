import type { Env } from "../../apps/web/src/server/env";
import { worker } from "../../apps/web/src/server/index";
import { MEMORY_FIXTURE_SQL } from "./memories";

const initialized = new WeakSet<D1Database>();
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		if (
			env.RESOURCE_ENV !== "test" ||
			(
				await env.DB.prepare("SELECT value FROM _test_marker WHERE key = 'env'").first<{
					value: string;
				}>()
			)?.value !== "test"
		)
			throw new Error("refusing fixture without local test marker");
		if (!initialized.has(env.DB)) {
			await env.DB.exec(MEMORY_FIXTURE_SQL);
			initialized.add(env.DB);
		}
		return worker.fetch(request, env, ctx);
	},
	scheduled: worker.scheduled,
};
