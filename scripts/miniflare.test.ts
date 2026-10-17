import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { describe, expect, it, vi } from "vitest";
import { rewriteWranglerConfig } from "./e2e";
import { ensureClientAssets } from "./ensure-dev-vars";
import { bundleWorker, miniflareOptions } from "./miniflare";

const config = rewriteWranglerConfig(
	await readFile("wrangler.toml", "utf8"),
	17059,
	"/assets",
	"/worker.ts",
);

describe("direct Miniflare runtime", () => {
	it("serves the Worker directly while retaining the actual static-assets binding", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octo-miniflare-"));
		ensureClientAssets(dir);
		const toml = rewriteWranglerConfig(
			await readFile("wrangler.toml", "utf8"),
			0,
			join(dir, "dist/client"),
			"/worker.ts",
		);
		const runtime = new Miniflare(
			miniflareOptions(
				toml,
				dir,
				'export default { async fetch(request, env) { const response = await env.ASSETS.fetch(request); return new Response(response.body, { headers: { "X-Test-Worker": "direct" } }); } }',
				{},
			),
		);
		try {
			const response = await fetch(new URL("/dashboard", await runtime.ready));
			expect(response.status).toBe(200);
			expect(response.headers.get("X-Test-Worker")).toBe("direct");
			expect(await response.text()).toContain("<title>octo</title>");
		} finally {
			await runtime.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	});
	it("maps only local D1, R2, assets and explicit test bindings", () => {
		const options = miniflareOptions(config, "/run", "export default {}", { RESOURCE_ENV: "test" });
		expect(options.host).toBe("127.0.0.1");
		expect(options.port).toBe(17059);
		expect(options.cf).toBe(false);
		expect(options.telemetry).toEqual({ enabled: false });
		expect(options.resourcePersistencePath).toBe("/run/v3");
		expect(options.workers).toHaveLength(2);
		const worker = options.workers[0];
		expect(worker?.config.env).toEqual({
			DB: { type: "d1", id: "11111111-1111-1111-1111-111111111111" },
			FILES: { type: "r2", name: "octo-files" },
			ASSETS: { type: "worker", worker: "octo-l2-assets" },
			RESOURCE_ENV: { type: "text", value: "test" },
		});
		expect(worker?.config.assets).toBeUndefined();
		expect(options.workers[1]?.config.assets).toMatchObject({
			directory: "/assets",
			notFoundHandling: "single-page-application",
		});
		expect(worker?.dev).toEqual({ unsafeRegisterWorker: false });
		expect(worker?.config.manifest?.modules["worker.mjs"]).toEqual({
			type: "esm",
			contents: "export default {}",
		});
	});
	it.each([
		"invalid = [",
		`${config}\n[[r2_buckets]]\nbinding="OTHER"\nbucket_name="other"\n`,
		`${config}\n[[routes]]\npattern="example.com"\n`,
		`${config}\n[[vectorize]]\nbinding="VEC"\n`,
		config.replace('binding = "DB"', 'binding = "OTHER"'),
		`${config}\n[unsafe]\nremote${" = true"}\n`,
	])("rejects unsafe runtime configuration", (toml) => {
		expect(() => miniflareOptions(toml, "/run", "", {})).toThrow();
	});
	it("bundles the actual fixture entrypoint without writing shared files", async () => {
		const build = vi
			.fn()
			.mockResolvedValue({ success: true, outputs: [{ text: async () => "worker code" }] });
		vi.stubGlobal("Bun", { build });
		expect(await bundleWorker("/worker.ts")).toBe("worker code");
		expect(build).toHaveBeenCalledWith({
			entrypoints: ["/worker.ts"],
			target: "browser",
			format: "esm",
		});
		build.mockResolvedValueOnce({
			success: false,
			outputs: [],
			logs: [new Error("compile failed")],
		});
		await expect(bundleWorker("/worker.ts")).rejects.toThrow("Worker bundle failed");
		build.mockResolvedValueOnce({ success: true, outputs: [], logs: [] });
		await expect(bundleWorker("/worker.ts")).rejects.toThrow("Worker bundle failed");
	});
});
