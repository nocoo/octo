import type { Context } from "hono";
import { z } from "zod";
import {
	BATCH_MAX_ITEMS,
	batchDeleteBodySchema,
	batchUpdateBodySchema,
} from "../../lib/schema/batch";
import { batchMoveSchema } from "../../lib/schema/memory-move";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { JSON_BODY_MAX_BYTES, parseStrict } from "../lib/validate";
import { MemoryRepo } from "../repo/memories";
import { readAuthorizationBody } from "./authorization-body";
import { currentMemoryAuthz } from "./memory-authorization";

const BATCH_JSON_BODY_MAX_BYTES = BATCH_MAX_ITEMS * JSON_BODY_MAX_BYTES;
const operations: Record<string, "write" | "update" | "delete" | "move"> = {
	"/memories:batchCreate": "write",
	"/memories:batchUpdate": "update",
	"/memories:batchDelete": "delete",
	"/memories:batchMove": "move",
};

export async function prepareBatchAuthorization(
	context: Context<{ Bindings: Env; Variables: AppVars }>,
	prefix = "/api/v1",
): Promise<void> {
	const op = operations[context.req.path.slice(prefix.length)];
	if (context.req.method === "POST" && (op === "update" || op === "delete" || op === "move")) {
		await readAuthorizationBody(context, BATCH_JSON_BODY_MAX_BYTES);
	}
}

const cachedBatchSchema = z.object({
	results: z.array(
		z.object({
			ok: z.boolean(),
			error: z.object({ code: z.string() }).optional(),
			item: z
				.object({
					id: z.string().optional(),
					space_id: z.string().optional(),
					source_key_id: z.string().optional(),
				})
				.optional(),
		}),
	),
});

export async function authorizeBatchReplay(
	context: Context<{ Bindings: Env; Variables: AppVars }>,
	outcome: { status: number; body: string },
	prefix = "/api/v1",
): Promise<void> {
	const op = operations[context.req.path.slice(prefix.length)];
	if (context.req.method !== "POST" || !op || outcome.status >= 400) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(outcome.body);
	} catch {
		throw new ApiError("unavailable", "invalid cached batch response");
	}
	const cached = cachedBatchSchema.safeParse(parsed);
	if (!cached.success) throw new ApiError("unavailable", "invalid cached batch response");
	let ids: string[] = [];
	let destination: string | undefined;
	if (op === "move") {
		const input = parseStrict(batchMoveSchema, await readAuthorizationBody(context));
		ids = input.items.map((item) => item.id);
		const space = await new MemoryRepo(context.env.DB).spaceBySlug(input.space);
		if (!space) throw new ApiError("not_found", "not found");
		destination = space.id;
	}
	if (op === "delete") {
		ids = parseStrict(
			batchDeleteBodySchema,
			await readAuthorizationBody(context, BATCH_JSON_BODY_MAX_BYTES),
		).ids;
	} else if (op === "update") {
		ids = parseStrict(
			batchUpdateBodySchema,
			await readAuthorizationBody(context, BATCH_JSON_BODY_MAX_BYTES),
		).items.map((item) => item.id);
	}
	const repo = new MemoryRepo(context.env.DB);
	const authz = await currentMemoryAuthz(context);
	for (const [index, result] of cached.data.results.entries()) {
		if (!result.ok && result.error?.code !== "version_conflict") continue;
		const id = op === "delete" || op === "move" || !result.ok ? ids[index] : result.item?.id;
		if (!id) throw new ApiError("unavailable", "invalid cached batch item");
		const row = await repo.get(id);
		if (!row || (op !== "delete" && row.deleted_at !== null))
			throw new ApiError("not_found", "not found");
		authz.denyUnless(op, {
			spaceId: row.space_id,
			sourceKeyId: row.source_key_id,
			...(destination ? { destSpaceId: destination } : {}),
		});
		if (result.ok && op !== "delete" && op !== "move") {
			const spaceId = result.item?.space_id;
			if (!spaceId || !result.item?.source_key_id) throw new ApiError("not_found", "not found");
			authz.denyUnless(op, { spaceId, sourceKeyId: result.item.source_key_id });
		}
	}
}
