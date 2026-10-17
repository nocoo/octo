import { Hono } from "hono";
import {
	BATCH_MAX_ITEMS,
	batchCreateBodySchema,
	batchDeleteBodySchema,
	batchUpdateBodySchema,
} from "../../../lib/schema/batch";
import type { ErrorCode } from "../../../lib/schema/errors";
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
			const { id, expected_version, ...patch } = item;
			try {
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
				results.push({ ok: true, item: await memoryService.delete(id, ctx) });
			} catch (err) {
				results.push(mapServiceError(err));
			}
		}
		return c.json({ results });
	});

	return app;
}
