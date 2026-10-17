import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	main,
	parseTomlVarsKeys,
	runGateWranglerVars,
	wranglerVarsViolations,
} from "./gate-wrangler-vars";

const example = [
	"API_KEY_PEPPER=change-me-api-key-pepper",
	"ATTACHMENT_URL_SECRET=change-me-attachment-url-secret",
	"OCTO_SETTINGS_KEY=change-me-octo-settings-key",
	"",
].join("\n");

describe("gate:wrangler-vars", () => {
	it("accepts toml without secrets or vars", () => {
		expect(wranglerVarsViolations("name = 'octo'\n", example)).toEqual([]);
	});

	it("requires secrets in the example file", () => {
		expect(
			wranglerVarsViolations("name = 'octo'\n", "PUBLIC=1\n").some((issue) =>
				issue.includes("API_KEY_PEPPER"),
			),
		).toBe(true);
	});

	it("rejects secrets in wrangler.toml and unknown [vars]", () => {
		const issues = wranglerVarsViolations(
			["[vars]", 'API_KEY_PEPPER = "x"', 'PUBLIC = "1"', ""].join("\n"),
			example,
		);
		expect(issues).toContain("[vars] contains secret API_KEY_PEPPER");
		expect(issues.some((issue) => issue.includes("PUBLIC"))).toBe(true);
	});

	it("allows documented non-secret [vars] and ignores later sections", () => {
		const documented = `${example}PUBLIC=1\n`;
		expect(
			wranglerVarsViolations(
				["[vars]", 'PUBLIC = "1"', "[env]", 'x = "y"', ""].join("\n"),
				documented,
			),
		).toEqual([]);
		expect(parseTomlVarsKeys("[env]\nFOO = 1\n")).toEqual([]);
	});

	it("runs against fixture files", async () => {
		const root = join(tmpdir(), `octo-vars-${Date.now()}`);
		await mkdir(root, { recursive: true });
		const toml = join(root, "wrangler.toml");
		const ex = join(root, "dev.vars.example");
		await writeFile(toml, "name = 'octo'\n");
		await writeFile(ex, example);
		try {
			expect(await runGateWranglerVars(toml, ex)).toBe(0);
			await writeFile(toml, 'API_KEY_PEPPER = "leak"\n');
			expect(await runGateWranglerVars(toml, ex)).toBe(1);
			expect(await runGateWranglerVars()).toBe(0);
			expect(await main()).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
