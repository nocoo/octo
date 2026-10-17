import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	ensureDevVars: vi.fn(),
	ensureClientAssets: vi.fn(),
	ensureLocalSchema: vi.fn(),
	writeDevWranglerConfig: vi.fn(),
}));

vi.mock("./ensure-dev-vars", () => ({
	ensureDevVars: mocks.ensureDevVars,
	ensureClientAssets: mocks.ensureClientAssets,
}));
vi.mock("./local-d1", () => ({ ensureLocalSchema: mocks.ensureLocalSchema }));
vi.mock("./local-config", () => ({
	LOCAL_WRANGLER_CONFIG: ".wrangler.local.toml",
	writeDevWranglerConfig: mocks.writeDevWranglerConfig,
}));

import { bunDevSpawn, main as devMain, prepareDev, runDev } from "./dev";
import { prepareServer, runDevServer, main as serverMain } from "./dev-server";

describe("prepare helpers", () => {
	it("prepares dev and server workspaces", async () => {
		prepareDev("/tmp");
		prepareServer("/tmp");
		expect(mocks.ensureDevVars).toHaveBeenCalled();
		expect(mocks.ensureClientAssets).toHaveBeenCalled();
		expect(mocks.ensureLocalSchema).toHaveBeenCalled();
		expect(mocks.writeDevWranglerConfig).toHaveBeenCalledWith("/tmp");
		const spawn = () => ({
			exited: Promise.resolve(0),
			kill: () => undefined,
		});
		expect(await runDev("/tmp", spawn)).toBe(0);
		expect(await runDevServer("/tmp", spawn)).toBe(0);
		expect(await devMain("/tmp", spawn, () => undefined)).toBe(0);
		expect(await serverMain("/tmp", spawn, () => undefined)).toBe(0);
	});

	it("spawns a short-lived process", async () => {
		const nativeBody = bunDevSpawn(
			["/bin/sh", "-c", 'test "$WRANGLER_DISABLE_REQUEST_BODY_DRAINING" = true'],
			process.cwd(),
		);
		expect(await nativeBody.exited).toBe(0);
		const child = bunDevSpawn(["/bin/echo", "ok"], process.cwd());
		expect(await child.exited).toBe(0);
		const missing = bunDevSpawn([], process.cwd());
		missing.kill();
		expect(await missing.exited).toBeGreaterThan(0);
		const sleeper = bunDevSpawn(["/bin/sleep", "30"], process.cwd());
		sleeper.kill();
		expect(await sleeper.exited).toBeGreaterThan(0);
	});
});
