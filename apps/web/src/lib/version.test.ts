import { describe, expect, it } from "vitest";
import pkg from "../../../../package.json" with { type: "json" };
import { APP_VERSION, versionLabel } from "./version";

describe("APP_VERSION", () => {
	it("matches package.json", () => {
		expect(APP_VERSION).toBe(pkg.version);
		expect(APP_VERSION).toBe("0.2.0");
		expect(versionLabel(APP_VERSION)).toBe("octo/0.2.0");
		expect(versionLabel("1.2.3", "x")).toBe("x/1.2.3");
	});
});
