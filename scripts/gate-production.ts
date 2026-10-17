import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { loadEnv } from "vite";
import { runIfMain } from "./cli";

export function productionViolations(
	toml: string,
	environment: Record<string, string | undefined>,
): string[] {
	const config = parse(toml) as {
		vars?: Record<string, unknown>;
		env?: Record<string, { vars?: Record<string, unknown> }>;
	};
	const values = [
		environment.ACCESS_DEV_BYPASS_EMAIL,
		config.vars?.ACCESS_DEV_BYPASS_EMAIL,
		...Object.values(config.env ?? {}).map((env) => env.vars?.ACCESS_DEV_BYPASS_EMAIL),
	];
	return values.some((value) => value !== undefined && String(value).trim() !== "")
		? ["Production requires ACCESS_DEV_BYPASS_EMAIL to be empty"]
		: [];
}

export async function runGateProduction(root = process.cwd()): Promise<number> {
	const environment = { ...loadEnv("production", join(root, "apps/web"), ""), ...process.env };
	const issues = productionViolations(
		await readFile(join(root, "wrangler.toml"), "utf8"),
		environment,
	);
	for (const issue of issues) console.error(issue);
	if (issues.length) return 1;
	console.log("gate:production passed");
	return 0;
}

export async function main(): Promise<number> {
	return runGateProduction();
}

await runIfMain(import.meta, main);
