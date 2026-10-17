import { describe, expect, it } from "vitest";
import { createApp } from "../index";
import { StubMemoryService } from "../services/stub-memories";
import { listedRoutes, routeKey, TESTED_API_ROUTES } from "./inventory";

describe("inventory", () => {
	it("lists Hono routes and matches the tested set", () => {
		expect(routeKey("get", "/api/live")).toBe("GET /api/live");
		expect(listedRoutes(createApp(new StubMemoryService()))).toEqual(TESTED_API_ROUTES);
	});
});
