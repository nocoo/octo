import { readFile } from "node:fs/promises";
import { runIfMain } from "./cli";

export const SECRET_VAR_NAMES = [
	"API_KEY_PEPPER",
	"ATTACHMENT_URL_SECRET",
	"OCTO_SETTINGS_KEY",
] as const;

export function parseExampleKeys(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="))
		.map((line) => line.slice(0, line.indexOf("=")));
}

export function parseTomlVarsKeys(text: string): string[] {
	const keys: string[] = [];
	let inVars = false;
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line.startsWith("[") && line.endsWith("]")) {
			inVars = line === "[vars]";
			continue;
		}
		if (inVars && line.includes("=")) {
			keys.push(line.slice(0, line.indexOf("=")).trim());
		}
	}
	return keys;
}

export function wranglerVarsViolations(toml: string, example: string): string[] {
	const issues: string[] = [];
	const exampleKeys = new Set(parseExampleKeys(example));
	const varsKeys = parseTomlVarsKeys(toml);
	for (const secret of SECRET_VAR_NAMES) {
		if (!exampleKeys.has(secret)) {
			issues.push(`dev.vars.example missing ${secret}`);
		}
		if (new RegExp(`\\b${secret}\\b`).test(toml)) {
			issues.push(`wrangler.toml must not contain secret ${secret}`);
		}
	}
	for (const key of varsKeys) {
		if ((SECRET_VAR_NAMES as readonly string[]).includes(key)) {
			issues.push(`[vars] contains secret ${key}`);
		} else if (!exampleKeys.has(key)) {
			issues.push(`[vars] key ${key} is missing from dev.vars.example`);
		}
	}
	return issues;
}

export async function runGateWranglerVars(
	tomlPath = "wrangler.toml",
	examplePath = "dev.vars.example",
): Promise<number> {
	const toml = await readFile(tomlPath, "utf8");
	const example = await readFile(examplePath, "utf8");
	const issues = wranglerVarsViolations(toml, example);
	if (issues.length > 0) {
		for (const issue of issues) {
			console.error(issue);
		}
		return 1;
	}
	console.log("gate:wrangler-vars passed");
	return 0;
}

export async function main(): Promise<number> {
	return runGateWranglerVars();
}

await runIfMain(import.meta, main);
