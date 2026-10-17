import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, productionViolations, runGateProduction } from "./gate-production";

afterEach(() => vi.unstubAllEnvs());

describe("production bypass assertion", () => {
	it.each([undefined, "", "  "])("accepts empty bypass %s", (bypass) => {
		expect(productionViolations("name='octo'", { ACCESS_DEV_BYPASS_EMAIL: bypass })).toEqual([]);
	});
	it("rejects a process bypass without exposing its value", () => {
		const issues = productionViolations("name='octo'", {
			ACCESS_DEV_BYPASS_EMAIL: "private@local",
		});
		expect(issues).toEqual(["Production requires ACCESS_DEV_BYPASS_EMAIL to be empty"]);
		expect(issues.join()).not.toContain("private@local");
	});
	it("rejects a production binding, including named deployment environments", () => {
		for (const section of ["vars", "env.production.vars"]) {
			expect(
				productionViolations(`[${section}]\nACCESS_DEV_BYPASS_EMAIL='dev@local'`, {}),
			).toHaveLength(1);
			expect(productionViolations(`[${section}]\nACCESS_DEV_BYPASS_EMAIL=''`, {})).toEqual([]);
		}
	});
	it("ignores local vars but checks Vite production env files before building", async () => {
		const root = await mkdtemp(join(tmpdir(), "octo-production-"));
		try {
			await mkdir(join(root, "apps/web"), { recursive: true });
			await writeFile(join(root, "wrangler.toml"), "name='octo'\n");
			await writeFile(join(root, ".dev.vars"), "ACCESS_DEV_BYPASS_EMAIL=dev@local\n");
			expect(await runGateProduction(root)).toBe(0);
			await writeFile(
				join(root, "apps/web/.env.production"),
				"ACCESS_DEV_BYPASS_EMAIL=dev@local\n",
			);
			expect(await runGateProduction(root)).toBe(1);
			vi.stubEnv("ACCESS_DEV_BYPASS_EMAIL", "dev@local");
			expect(await main()).toBe(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
