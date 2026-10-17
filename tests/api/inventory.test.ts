import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/web/src/server/index";
import { listedRoutes, TESTED_API_ROUTES } from "../../apps/web/src/server/lib/inventory";
import { StubMemoryService } from "../../apps/web/src/server/services/stub-memories";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";

describe("api inventory", () => {
	it("covers every Hono route with an L2 test", async () => {
		expect(listedRoutes(createApp(new StubMemoryService()))).toEqual([...TESTED_API_ROUTES].sort());
		for (const key of TESTED_API_ROUTES) {
			const [method, path] = key.split(" ");
			if (!method || !path) {
				throw new Error(`invalid route key ${key}`);
			}
			const res = await fetch(`${base}${path}`, { method });
			expect(res.status).toBeLessThan(500);
		}
	});
});
