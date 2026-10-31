import type { Env } from "../../apps/web/src/server/env";
import { worker } from "../../apps/web/src/server/index";
import { profileTestEnv } from "./author-profiles";

export default {
	fetch(request: Request, env: Env, context: ExecutionContext) {
		return worker.fetch(request, profileTestEnv(env), context);
	},
	scheduled: worker.scheduled,
};
