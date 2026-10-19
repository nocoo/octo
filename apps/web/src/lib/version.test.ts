import { describe, expect, it } from "vitest";
import pkg from "../../../../package.json" with { type: "json" };
import { APP_VERSION, versionLabel } from "./version";

describe("APP_VERSION", () => {
	it("matches package.json", () => {
		expect(APP_VERSION).toBe(pkg.version);
		expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(versionLabel(APP_VERSION)).toBe(`octo/${pkg.version}`);
		expect(versionLabel("1.2.3", "x")).toBe("x/1.2.3");
	});
});
