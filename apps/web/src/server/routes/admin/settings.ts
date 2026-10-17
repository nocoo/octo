import { Hono } from "hono";
import type { AppVars, Env } from "../../env";
import { jsonOk } from "../../lib/errors";
import { readJsonLimited } from "../../lib/validate";
import {
	getEmbeddingSettings,
	saveEmbeddingSettings,
	testEmbeddingSettings,
} from "../../settings/config";

export function settingsRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
	app.get("/embedding", async (c) => jsonOk(await getEmbeddingSettings(c.env)));
	app.put("/embedding", async (c) =>
		jsonOk(
			await saveEmbeddingSettings(
				c.env,
				await readJsonLimited(c.req.raw, 16_384),
				`admin:${c.get("adminEmail")}`,
			),
		),
	);
	app.post("/embedding/test", async (c) =>
		jsonOk(await testEmbeddingSettings(c.env, await readJsonLimited(c.req.raw, 16_384))),
	);
	return app;
}
