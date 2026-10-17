import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const baseURL = process.env.OCTO_E2E;
const artifacts = process.env.OCTO_L3_ARTIFACTS;
if (baseURL !== "http://127.0.0.1:27059" || !artifacts) {
	throw new Error("Run L3 through bun run test:e2e:bdd; isolated local Worker is required");
}

export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: "**/*.spec.ts",
	globalSetup: "./tests/e2e/setup.ts",
	outputDir: join(artifacts, "browser"),
	fullyParallel: false,
	workers: 1,
	retries: 0,
	forbidOnly: true,
	timeout: 45_000,
	expect: { timeout: 10_000 },
	reporter: [["list"], ["html", { outputFolder: join(artifacts, "report"), open: "never" }]],
	use: {
		baseURL,
		serviceWorkers: "block",
		trace: "off",
		video: "off",
		screenshot: "off",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
		},
	],
});
