import { describe, expect, it } from "vitest";
import config from "../vite.config";
import { DEV_WORKER_PORT } from "./ports";

describe("vite dev proxy", () => {
	it("forwards api, files, and mcp to the worker", () => {
		const proxy = config.server?.proxy;
		expect(proxy).toBeDefined();
		for (const path of ["/api", "/files", "/mcp"]) {
			expect(proxy).toHaveProperty(path, `http://127.0.0.1:${DEV_WORKER_PORT}`);
		}
		expect(config.server?.allowedHosts).toContain("octo.dev.hexly.ai");
	});
});
