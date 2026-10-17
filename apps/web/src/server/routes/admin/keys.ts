import { Hono } from "hono";
import { adminActor } from "../../admin/common";
import {
	keyCreateSchema,
	keyPatchSchema,
	keyRotateSchema,
	resolveKeyInput,
} from "../../admin/key-input";
import { createKey, loadKey, publicKey, revokeKey, rotateKey, updateKey } from "../../admin/keys";
import type { ApiKeyRow } from "../../auth/api-key";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";
import { listEnvelope } from "../../lib/http";
import { parseStrict, readJsonLimited } from "../../lib/validate";

export function keysRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.use("*", async (context, next) => {
		adminActor(context);
		await next();
		context.header("Cache-Control", "no-store");
	});
	app.get("/", async (context) => {
		const { results } = await context.env.DB.prepare(
			"SELECT * FROM api_keys ORDER BY name, id",
		).all<ApiKeyRow>();
		return jsonOk(listEnvelope(results.map(publicKey)));
	});
	app.post("/", async (context) => {
		const input = parseStrict(keyCreateSchema, await readJsonLimited(context.req.raw));
		return jsonOk(
			await createKey(
				context.env.DB,
				context.env.API_KEY_PEPPER,
				await resolveKeyInput(context.env.DB, input),
				adminActor(context),
			),
			201,
		);
	});
	app.get("/:id", async (context) =>
		jsonOk(publicKey(await loadKey(context.env.DB, context.req.param("id")))),
	);
	app.patch("/:id", async (context) => {
		const row = await loadKey(context.env.DB, context.req.param("id"));
		const input = parseStrict(keyPatchSchema, await readJsonLimited(context.req.raw));
		return jsonOk(
			await updateKey(
				context.env.DB,
				row,
				await resolveKeyInput(context.env.DB, input, row),
				adminActor(context),
			),
		);
	});
	app.delete("/:id", async (context) =>
		jsonOk(
			await revokeKey(
				context.env.DB,
				await loadKey(context.env.DB, context.req.param("id")),
				adminActor(context),
			),
		),
	);
	app.post("/:id/revoke", async (context) =>
		jsonOk(
			await revokeKey(
				context.env.DB,
				await loadKey(context.env.DB, context.req.param("id")),
				adminActor(context),
			),
		),
	);
	app.post("/:id/rotate", async (context) => {
		const row = await loadKey(context.env.DB, context.req.param("id"));
		const input = parseStrict(
			keyRotateSchema,
			context.req.raw.body === null ? {} : await readJsonLimited(context.req.raw),
		);
		return jsonOk(
			await rotateKey(
				context.env.DB,
				context.env.API_KEY_PEPPER,
				row,
				input.grace_ms,
				adminActor(context),
			),
		);
	});
	return app;
}
