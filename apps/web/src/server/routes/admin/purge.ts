import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import { cursorSecretFromEnv, encodeCursor } from "../../http/cursor";
import { ApiError, jsonOk } from "../../lib/errors";
import { parseStrict, readJsonLimited } from "../../lib/validate";
import { cleanupExternalFiles, purgeMemory } from "../../purge/service";
import {
	emptySchema,
	idsSchema,
	listTrash,
	trashCount,
	trashIds,
	trashSnapshot,
} from "../../purge/trash";
import { authzFrom, MemoryService } from "../../services/memories";
import { adminPrincipal } from "./parity";

type ItemResult = { id: string; ok: boolean; error?: { code: string; message: string } };

async function itemResult(id: string, operation: () => Promise<unknown>): Promise<ItemResult> {
	try {
		await operation();
		return { id, ok: true };
	} catch (error) {
		const code = error instanceof ApiError ? error.code : "unavailable";
		return {
			id,
			ok: false,
			error: {
				code,
				message:
					code === "not_found"
						? "memory not found in trash"
						: code === "version_conflict"
							? "memory changed; refresh and retry"
							: "operation failed; retry later",
			},
		};
	}
}

export function createAdminPurgeRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.get("/trash", adminPrincipal, async (context) =>
		jsonOk(await listTrash(context.env, context.req.queries())),
	);
	for (const operation of ["batchRestore", "batchPurge"] as const) {
		app.post(`/trash:${operation}`, adminPrincipal, async (context) => {
			const { ids } = parseStrict(idsSchema, await readJsonLimited(context.req.raw, 16_384));
			if (ids.length > 100) throw new ApiError("payload_too_large", "at most 100 ids");
			const counts = { requested: ids.length, succeeded: 0, failed: 0 };
			context.set("bulkCounts", counts);
			const service = new MemoryService(context.env.DB);
			const authz = authzFrom(context.get("apiKey"));
			const results: ItemResult[] = [];
			for (const id of ids) {
				const result = await itemResult(id, () =>
					operation === "batchRestore"
						? service.restore(authz, id)
						: purgeMemory(context.env.DB, id, `admin:${context.get("adminEmail")}`, {
								missingOk: true,
							}),
				);
				results.push(result);
				if (result.ok) counts.succeeded++;
				else counts.failed++;
			}
			if (operation === "batchPurge")
				context.executionCtx.waitUntil(
					cleanupExternalFiles(context.env, 10).catch(() =>
						console.error("purge file cleanup failed"),
					),
				);
			return jsonOk({ results, succeeded: counts.succeeded, failed: counts.failed });
		});
	}
	app.post("/trash:empty", adminPrincipal, async (context) => {
		const input = parseStrict(emptySchema, await readJsonLimited(context.req.raw, 16_384));
		const filters = input.filters ?? {};
		const cursor = await trashSnapshot(context.env, filters, "trash-empty", input.cursor);
		if (input.expected_count !== undefined && input.expected_count !== cursor.total)
			throw new ApiError("version_conflict", "trash count changed; refresh and confirm again");
		const ids = cursor.ids ?? (await trashIds(context.env, filters, cursor));
		const counts = { requested: ids.length, succeeded: 0, failed: 0 };
		context.set("bulkCounts", counts);
		const results: ItemResult[] = [];
		let purged = 0;
		for (const id of ids) {
			const result = await itemResult(id, async () => {
				const deleted = await purgeMemory(
					context.env.DB,
					id,
					`admin:${context.get("adminEmail")}`,
					{ head: cursor.head, missingOk: true },
				);
				if (deleted.purged) purged++;
			});
			results.push(result);
			if (result.ok) counts.succeeded++;
			else counts.failed++;
		}
		const after = ids.at(-1);
		const next = after ? await trashIds(context.env, filters, { ...cursor, after }) : [];
		const next_cursor = next.length
			? await encodeCursor(cursorSecretFromEnv(context.env), { ...cursor, after, ids: next })
			: null;
		const remaining = await trashCount(context.env, filters, cursor.head);
		context.executionCtx.waitUntil(
			cleanupExternalFiles(context.env, 10).catch(() => console.error("purge file cleanup failed")),
		);
		return jsonOk({ results, purged, remaining, next_cursor });
	});
	app.delete("/trash/:id", async (context) => {
		const email = context.get("adminEmail");
		if (!email) throw new ApiError("unauthenticated", "unauthenticated");
		const result = await purgeMemory(context.env.DB, context.req.param("id"), `admin:${email}`);
		context.executionCtx.waitUntil(
			cleanupExternalFiles(context.env).catch(() => {
				console.error("purge file cleanup failed");
			}),
		);
		return jsonOk(result);
	});
	return app;
}
