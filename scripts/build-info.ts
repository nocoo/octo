import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runIfMain } from "./cli";

export async function generateBuildInfo(
	root = process.cwd(),
	command = process.env.WRANGLER_COMMAND,
): Promise<number> {
	const production = command === "deploy" || command === "versions upload";
	const info = {
		git_sha: production
			? execFileSync("git", ["rev-parse", "--short", "HEAD"], {
					cwd: root,
					encoding: "utf8",
				}).trim()
			: "unknown",
		build_time: production ? new Date().toISOString() : "unknown",
	};
	await mkdir(join(root, ".wrangler"), { recursive: true });
	await writeFile(
		join(root, ".wrangler/build-info.ts"),
		`export const BUILD_INFO = ${JSON.stringify(info)};\n`,
	);
	return 0;
}

export async function main(): Promise<number> {
	return generateBuildInfo();
}

await runIfMain(import.meta, main);
