import { readFile } from "node:fs/promises";
import { runIfMain } from "./cli";

export async function assertCoverageScript(packagePath = "package.json"): Promise<number> {
	const raw = await readFile(packagePath, "utf8");
	const manifest = JSON.parse(raw) as { scripts?: Record<string, string> };
	const command = manifest.scripts?.["test:coverage"];
	if (!command) {
		console.error("gate:coverage-script: missing test:coverage script");
		return 1;
	}
	if (!command.includes("vitest") || !command.includes("--coverage")) {
		console.error(
			`gate:coverage-script: test:coverage must invoke vitest --coverage (got ${command})`,
		);
		return 1;
	}
	console.log("gate:coverage-script passed");
	return 0;
}

export async function main(): Promise<number> {
	return assertCoverageScript();
}

await runIfMain(import.meta, main);
