import type { MiddlewareHandler } from "hono";
import type { AppVars, Env } from "../env";

export function postCommitMiddleware(
	process: (env: Env) => Promise<unknown>,
): MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> {
	return async (context, next) => {
		await next();
		if (
			!["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method) ||
			context.res.status >= 400 ||
			(/\/memories(?:\/|:|$)/.test(context.req.path) &&
				context.get("writeStatements")?.length === 0) ||
			(context.req.method === "POST" &&
				["/search", "/memories:batchGet", "/settings/embedding/test"].some((suffix) =>
					context.req.path.endsWith(suffix),
				))
		)
			return;
		let execution: Pick<ExecutionContext, "waitUntil">;
		try {
			execution = context.executionCtx;
		} catch {
			return;
		}
		const work = process(context.env).catch(() => {
			console.error("derived_work_failed");
		});
		if (context.env.RESOURCE_ENV === "test" && context.env.OCTO_VECTOR_SYNC_PARALLEL === "1") {
			await work;
		} else {
			execution.waitUntil(work);
		}
	};
}
