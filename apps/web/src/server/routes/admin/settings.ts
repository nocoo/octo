import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";
import { readJsonLimited } from "../../lib/validate";
import { backfillWordIndex } from "../../search/word-backfill";
import {
	getEmbeddingSettings,
	saveEmbeddingSettings,
	testEmbeddingSettings,
} from "../../settings/config";

export function settingsRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.post("/search/backfill", async (context) => jsonOk(await backfillWordIndex(context.env.DB)));
	app.get("/embedding", async (context) => jsonOk(await getEmbeddingSettings(context.env)));
	app.put("/embedding", async (context) =>
		jsonOk(
			await saveEmbeddingSettings(
				context.env,
				await readJsonLimited(context.req.raw, 16_384),
				`admin:${context.get("adminEmail")}`,
			),
		),
	);
	app.post("/embedding/test", async (context) =>
		jsonOk(
			await testEmbeddingSettings(context.env, await readJsonLimited(context.req.raw, 16_384)),
		),
	);
	return app;
}
