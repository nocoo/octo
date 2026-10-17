import { readFile } from "node:fs/promises";
import { runIfMain } from "./cli";
import { collectTsFiles } from "./fs-walk";

const skip = "skip";
const only = "only";
const todo = "todo";
const xTest = `x${"test"}`;
const xDescribe = `x${"describe"}`;
export const SKIP_PATTERN = new RegExp(
	`\\.(?:${only}|${skip}|${todo}|fails|runIf|skipIf)\\b|\\b(?:${xTest}|${xDescribe}|it\\.${todo}|test\\.concurrent\\.${todo})\\b`,
);

export const TEST_SKIP_ROOTS = ["apps/web/src", "scripts", "tests"];

export async function scanSkippedTests(roots: string[]): Promise<string[]> {
	const files: string[] = [];
	for (const root of roots) {
		await collectTsFiles(root, files);
	}
	const hits: string[] = [];
	for (const file of files) {
		const text = await readFile(file, "utf8");
		for (const [index, line] of text.split("\n").entries()) {
			if (SKIP_PATTERN.test(line)) {
				hits.push(`${file}:${index + 1}: skipped or focused test`);
			}
		}
	}
	return hits;
}

export async function runGateTestSkip(roots = TEST_SKIP_ROOTS): Promise<number> {
	const hits = await scanSkippedTests(roots);
	if (hits.length > 0) {
		for (const hit of hits) {
			console.error(hit);
		}
		return 1;
	}
	console.log("gate:test-skip passed");
	return 0;
}

export async function main(): Promise<number> {
	return runGateTestSkip();
}

await runIfMain(import.meta, main);
