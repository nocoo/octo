import { Hono } from "hono";
import {
	BATCH_MAX_ITEMS,
	batchCreateBodySchema,
	batchDeleteBodySchema,
	batchUpdateBodySchema,
} from "../../../lib/schema/batch";
import type { ErrorCode } from "../../../lib/schema/errors";
import { type AuthzOp, type AuthzTarget, authorize } from "../../auth/authorize";
import type { AppVars, Env } from "../../env";
import { ApiError } from "../../lib/errors";
import { parseStrict } from "../../lib/validate";
import type { MemoryService } from "../../services/memories";
import { parseJsonBody } from "./json-body";

type BatchOk<T> = { ok: true; item: T };
type BatchErr = {
	ok: false;
	error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
};
type BatchResult<T> = BatchOk<T> | BatchErr;

function serviceCtx(c: { get: (key: "apiKey") => { id: string } }): {
	keyId: string;
	actor: string;
} {
	const keyId = c.get("apiKey").id;
	return { keyId, actor: `key:${keyId}` };
}

function mapServiceError(err: unknown): BatchErr {
	if (err instanceof ApiError) {
		const error: BatchErr["error"] = {
			code: err.code,
			message: err.message,
		};
		if (err.details) {
			error.details = err.details;
		}
		return { ok: false, error };
	}
	return { ok: false, error: { code: "internal", message: "internal error" } };
}

function batchAuthDenied(
	c: { get: (key: "apiKey") => import("../../auth/authorize").ApiPrincipal },
	op: AuthzOp,
	target: AuthzTarget,
): BatchErr | null {
	const result = authorize(c.get("apiKey"), op, target);
	if (result.allow) {
		return null;
	}
	const code: ErrorCode = result.reason === "not_found" ? "not_found" : "forbidden";
	return {
		ok: false,
		error: { code, message: code === "forbidden" ? "forbidden" : "not found" },
	};
}

export function createBatchRoutes(
	memoryService: MemoryService,
): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.post("/memories:batchCreate", async (c) => {
		const body = parseStrict(batchCreateBodySchema, parseJsonBody(await c.req.text()));
		if (body.items.length > BATCH_MAX_ITEMS) {
			throw new ApiError("payload_too_large", "batch exceeds 100 items");
		}
		const ctx = serviceCtx(c);
		const results: BatchResult<Awaited<ReturnType<MemoryService["create"]>>>[] = [];
		for (const item of body.items) {
			try {
				const spaceId = await memoryService.resolveSpace(item.space, ctx);
				const denied = batchAuthDenied(c, "write", { spaceId });
				if (denied) {
					results.push(denied);
					continue;
				}
				results.push({ ok: true, item: await memoryService.create(item, ctx) });
			} catch (err) {
				results.push(mapServiceError(err));
			}
		}
		return c.json({ results });
	});

	app.post("/memories:batchUpdate", async (c) => {
		const body = parseStrict(batchUpdateBodySchema, parseJsonBody(await c.req.text()));
		if (body.items.length > BATCH_MAX_ITEMS) {
			throw new ApiError("payload_too_large", "batch exceeds 100 items");
		}
		const ctx = serviceCtx(c);
		const results: BatchResult<Awaited<ReturnType<MemoryService["update"]>>>[] = [];
		for (const item of body.items) {
			try {
				const { id, expected_version, ...patch } = item;
				const existing = await memoryService.get(id, ctx);
				if (!existing) {
					results.push({
						ok: false,
						error: { code: "not_found", message: "not found" },
					});
					continue;
				}
				const denied = batchAuthDenied(c, "update", {
					spaceId: existing.space_id,
					sourceKeyId: existing.source_key_id,
				});
				if (denied) {
					results.push(denied);
					continue;
				}
				if (patch.space && patch.space !== existing.space) {
					const moveDenied = batchAuthDenied(c, "move", {
						spaceId: existing.space_id,
						destSpaceId: await memoryService.resolveSpace(patch.space, ctx),
						sourceKeyId: existing.source_key_id,
					});
					if (moveDenied) {
						results.push(moveDenied);
						continue;
					}
				}
				results.push({
					ok: true,
					item: await memoryService.update(id, { ...patch, expected_version }, ctx),
				});
			} catch (err) {
				results.push(mapServiceError(err));
			}
		}
		return c.json({ results });
	});

	app.post("/memories:batchDelete", async (c) => {
		const body = parseStrict(batchDeleteBodySchema, parseJsonBody(await c.req.text()));
		if (body.ids.length > BATCH_MAX_ITEMS) {
			throw new ApiError("payload_too_large", "batch exceeds 100 items");
		}
		const ctx = serviceCtx(c);
		const results: BatchResult<{ trashed_at: string }>[] = [];
		for (const id of body.ids) {
			try {
				const existing = await memoryService.get(id, ctx);
				if (!existing) {
					results.push({
						ok: false,
						error: { code: "not_found", message: "not found" },
					});
					continue;
				}
				const denied = batchAuthDenied(c, "delete", {
					spaceId: existing.space_id,
					sourceKeyId: existing.source_key_id,
				});
				if (denied) {
					results.push(denied);
					continue;
				}
				results.push({ ok: true, item: await memoryService.delete(id, ctx) });
			} catch (err) {
				results.push(mapServiceError(err));
			}
		}
		return c.json({ results });
	});

	return app;
}
