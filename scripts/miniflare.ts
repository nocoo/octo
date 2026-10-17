import { join } from "node:path";
import type { MiniflareOptions } from "miniflare";
import { parse } from "smol-toml";
import { z } from "zod";
import { valueHasRemoteTrue } from "./gate-no-remote";

const localConfig = z.object({
	name: z.string(),
	compatibility_date: z.string(),
	dev: z.object({ port: z.number() }),
	assets: z.object({
		directory: z.string(),
		binding: z.literal("ASSETS"),
		run_worker_first: z.array(z.string()),
		not_found_handling: z.literal("single-page-application"),
	}),
	d1_databases: z.tuple([z.object({ binding: z.literal("DB"), database_id: z.string() })]),
	r2_buckets: z.tuple([z.object({ binding: z.literal("FILES"), bucket_name: z.string() })]),
	vectorize: z.never().optional(),
	routes: z.never().optional(),
});

export function miniflareOptions(
	toml: string,
	persistTo: string,
	script: string,
	bindings: NodeJS.Dict<string>,
): MiniflareOptions {
	const parsed = parse(toml);
	if (valueHasRemoteTrue(parsed)) throw new Error("remote bindings are forbidden");
	const config = localConfig.parse(parsed);
	return {
		host: "127.0.0.1",
		port: config.dev.port,
		cf: false,
		telemetry: { enabled: false },
		resourcePersistencePath: join(persistTo, "v3"),
		workers: [
			{
				config: {
					name: config.name,
					compatibilityDate: config.compatibility_date,
					manifest: {
						mainModule: "worker.mjs",
						modules: { "worker.mjs": { type: "esm", contents: script } },
					},
					env: {
						...Object.fromEntries(
							Object.entries(bindings).map(([key, value]) => [
								key,
								{ type: "text" as const, value },
							]),
						),
						DB: { type: "d1", id: config.d1_databases[0].database_id },
						FILES: { type: "r2", name: config.r2_buckets[0].bucket_name },
						ASSETS: { type: "worker", worker: "octo-l2-assets" },
					},
				},
				dev: { unsafeRegisterWorker: false },
			},
			{
				config: {
					name: "octo-l2-assets",
					compatibilityDate: config.compatibility_date,
					manifest: {
						mainModule: "assets.mjs",
						modules: { "assets.mjs": { type: "esm", contents: "export default {}" } },
					},
					assets: {
						directory: config.assets.directory,
						hasUserWorker: false,
						notFoundHandling: config.assets.not_found_handling,
					},
				},
				dev: { unsafeRegisterWorker: false },
			},
		],
	};
}

export async function bundleWorker(entrypoint: string): Promise<string> {
	const result = await Bun.build({ entrypoints: [entrypoint], target: "browser", format: "esm" });
	const output = result.outputs[0];
	if (!result.success || !output) throw new AggregateError(result.logs, "Worker bundle failed");
	return output.text();
}
