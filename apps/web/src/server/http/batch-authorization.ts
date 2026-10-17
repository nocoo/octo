import type { Context } from "hono";
import { z } from "zod";
import {
	BATCH_MAX_ITEMS,
	batchDeleteBodySchema,
	batchUpdateBodySchema,
} from "../../lib/schema/batch";
import type { AppVars, Env } from "../env";
import { ApiError } from "../lib/errors";
import { JSON_BODY_MAX_BYTES, parseStrict } from "../lib/validate";
import { MemoryRepo } from "../repo/memories";
import { readAuthorizationBody } from "./authorization-body";
import { currentMemoryAuthz } from "./memory-authorization";

const BATCH_JSON_BODY_MAX_BYTES = BATCH_MAX_ITEMS * JSON_BODY_MAX_BYTES;
const operations: Record<string, "write" | "update" | "delete"> = {
	"/api/v1/memories:batchCreate": "write",
	"/api/v1/memories:batchUpdate": "update",
	"/api/v1/memories:batchDelete": "delete",
};

export async function prepareBatchAuthorization(
	c: Context<{ Bindings: Env; Variables: AppVars }>,
): Promise<void> {
	const op = operations[c.req.path];
	if (c.req.method === "POST" && (op === "update" || op === "delete")) {
		await readAuthorizationBody(c, BATCH_JSON_BODY_MAX_BYTES);
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
	c: Context<{ Bindings: Env; Variables: AppVars }>,
	outcome: { status: number; body: string },
): Promise<void> {
	const op = operations[c.req.path];
	if (c.req.method !== "POST" || !op || outcome.status >= 400) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(outcome.body);
	} catch {
		throw new ApiError("unavailable", "invalid cached batch response");
	}
	const cached = cachedBatchSchema.safeParse(parsed);
	if (!cached.success) throw new ApiError("unavailable", "invalid cached batch response");
	let ids: string[] = [];
	if (op === "delete") {
		ids = parseStrict(
			batchDeleteBodySchema,
			await readAuthorizationBody(c, BATCH_JSON_BODY_MAX_BYTES),
		).ids;
	} else if (op === "update") {
		ids = parseStrict(
			batchUpdateBodySchema,
			await readAuthorizationBody(c, BATCH_JSON_BODY_MAX_BYTES),
		).items.map((item) => item.id);
	}
	const repo = new MemoryRepo(c.env.DB);
	const authz = await currentMemoryAuthz(c);
	for (const [index, result] of cached.data.results.entries()) {
		if (!result.ok && result.error?.code !== "version_conflict") continue;
		const id = op === "delete" || !result.ok ? ids[index] : result.item?.id;
		if (!id) throw new ApiError("unavailable", "invalid cached batch item");
		const row = await repo.get(id);
		if (!row || (op !== "delete" && row.deleted_at !== null))
			throw new ApiError("not_found", "not found");
		authz.denyUnless(op, { spaceId: row.space_id, sourceKeyId: row.source_key_id });
		if (result.ok && op !== "delete") {
			const spaceId = result.item?.space_id;
			if (!spaceId || !result.item?.source_key_id) throw new ApiError("not_found", "not found");
			authz.denyUnless(op, { spaceId, sourceKeyId: result.item.source_key_id });
		}
	}
}
