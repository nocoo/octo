import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it, vi } from "vitest";
import { runDev } from "./dev";
import { runDevServer } from "./dev-server";

vi.mock("./local-d1", () => ({ ensureLocalSchema: vi.fn() }));

describe("daily local config startup", () => {
	it.each(["dev", "dev:server"])(
		"%s actually launches with a local config and unchanged path/persistence roots",
		async (entrypoint) => {
			const cwd = await mkdtemp(join(tmpdir(), "octo-local-config-"));
			const productionToml = await readFile("wrangler.toml", "utf8");
			const production = parse(productionToml);
			await writeFile(join(cwd, "wrangler.toml"), productionToml);
			await writeFile(join(cwd, "dev.vars.example"), "API_KEY_PEPPER=local-test\n");
			const commands: string[][] = [];
			const spawn = (args: string[]) => {
				commands.push(args);
				return { exited: Promise.resolve(0), kill: () => undefined };
			};
			try {
				if (entrypoint === "dev") await runDev(cwd, spawn);
				else await runDevServer(cwd, spawn);
				const args = commands[0] as string[];
				const configAt = args.indexOf("--config");
				expect(configAt).toBeGreaterThan(0);
				const configPath = args[configAt + 1] as string;
				const local = parse(await readFile(configPath, "utf8"));
				expect(local.vectorize).toBeUndefined();
				expect(local.routes).toBeUndefined();
				expect(local.build).toBeUndefined();
				expect(local.alias).toBeUndefined();
				expect(local).toEqual(
					Object.fromEntries(
						Object.entries(production).filter(
							([key]) => !["vectorize", "routes", "build", "alias"].includes(key),
						),
					),
				);
				expect(dirname(configPath)).toBe(cwd);
				expect(resolve(dirname(configPath), local.main as string)).toBe(
					join(cwd, "apps/web/src/server/index.ts"),
				);
				const assets = local.assets as { directory: string };
				expect(resolve(dirname(configPath), assets.directory)).toBe(join(cwd, "dist/client"));
				expect(join(dirname(configPath), ".wrangler/state")).toBe(join(cwd, ".wrangler/state"));
				expect(await readFile(join(cwd, ".dev.vars"), "utf8")).toContain("local-test");
				expect(args).toEqual(
					expect.arrayContaining(["--local", "--var", "RESOURCE_ENV:development"]),
				);
				expect(await readFile(join(cwd, "wrangler.toml"), "utf8")).toBe(productionToml);
				expect(production.vectorize).toEqual([
					{ binding: "VEC", index_name: "octo-vec-te3-small-1536", remote: false },
				]);
				expect(production.routes).toEqual([{ pattern: "octo.hexly.ai", custom_domain: true }]);
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
		},
	);
});
