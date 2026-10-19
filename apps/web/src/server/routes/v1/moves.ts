import { Hono } from "hono";
import { BATCH_MAX_ITEMS } from "../../../lib/schema/batch";
import { batchMoveSchema, memoryMoveSchema } from "../../../lib/schema/memory-move";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { parseStrict, readJsonLimited } from "../../lib/validate";
import { BatchMemoryService, type MemoryServiceContext } from "../../services/batch-memories";
import { authzFrom } from "../../services/memories";
import { memoryService } from "./memory-service";

export function moveRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.post("/memories/:id/move", async (context) => {
		const input = parseStrict(memoryMoveSchema, await readJsonLimited(context.req.raw));
		return jsonOk(
			await memoryService(context).move(
				authzFrom(context.get("apiKey")),
				context.req.param("id"),
				input,
				context.req.header("If-Match"),
			),
		);
	});
	app.post("/memories:batchMove", async (context) => {
		const input = parseStrict(batchMoveSchema, await readJsonLimited(context.req.raw));
		if (input.items.length > BATCH_MAX_ITEMS)
			throw new ApiError("payload_too_large", "batch exceeds 100 items");
		const vectorMemoryIds: string[] = [];
		context.set("vectorMemoryIds", vectorMemoryIds);
		const state: MemoryServiceContext = {
			db: context.env.DB,
			principal: context.get("apiKey"),
			statements: context.get("writeStatements"),
			vectorMemoryIds,
			setWriteError: (mapper) => context.set("writeError", mapper),
		};
		const service = new BatchMemoryService();
		const results = [];
		for (const item of input.items) {
			const rollback = service.checkpoint(state);
			try {
				await service.move(
					item.id,
					{ space: input.space, expected_version: item.expected_version },
					state,
				);
				results.push({ id: item.id, ok: true });
			} catch (error) {
				rollback();
				const known =
					error instanceof ApiError ? error : new ApiError("internal", "internal error");
				results.push({
					id: item.id,
					ok: false,
					error: {
						code: known.code,
						message: known.message,
						...(known.details ? { details: known.details } : {}),
					},
				});
			}
		}
		return jsonOk({ results });
	});
	return app;
}
