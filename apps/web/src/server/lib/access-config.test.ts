import { describe, expect, it } from "vitest";
import { ACCESS_AUD, ACCESS_TEAM_DOMAIN } from "./access-config";

describe("access-config", () => {
	it("pins the production Access audience and team", () => {
		expect(ACCESS_TEAM_DOMAIN).toBe("https://nocoo.cloudflareaccess.com");
		expect(ACCESS_AUD).toBe("9ab761cffd4ad657004e429d74e5524232d3b017775548211f5e0eb809a88d67");
	});
});
