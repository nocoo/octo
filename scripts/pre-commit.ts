import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIfMain } from "./cli";

export const L1_SCRIPTS = [
	"typecheck",
	"lint",
	"gate:test-skip",
	"gate:no-remote",
	"gate:wrangler-vars",
	"gate:client-fetch",
	"gate:client-design",
	"test:coverage",
] as const;

export function exportIndex(repo: string, dest: string): void {
	const prefix = dest.endsWith("/") ? dest : `${dest}/`;
	execFileSync("git", ["checkout-index", "-a", "-f", `--prefix=${prefix}`], { cwd: repo });
}

export function linkSnapshotDeps(repo: string, dest: string): void {
	for (const directory of ["node_modules", "apps/web/node_modules"]) {
		const modules = join(repo, directory);
		if (existsSync(modules)) {
			execFileSync("ln", ["-s", modules, join(dest, directory)]);
		}
	}
}

export type L1Spawn = (
	cmd: string,
	args: string[],
	opts: { cwd: string; stdio: "inherit" },
) => { status: number | null };

export function runL1(cwd: string, spawn: L1Spawn = spawnSync): number {
	for (const name of L1_SCRIPTS) {
		const result = spawn("bun", ["run", name], { cwd, stdio: "inherit" });
		if ((result.status ?? 1) !== 0) {
			return result.status ?? 1;
		}
	}
	return 0;
}

export async function runPreCommit(
	repo = process.cwd(),
	checks: (cwd: string) => Promise<number> | number = runL1,
): Promise<number> {
	const dest = await mkdtemp(join(tmpdir(), "octo-index-"));
	try {
		exportIndex(repo, dest);
		linkSnapshotDeps(repo, dest);
		return await checks(dest);
	} finally {
		await rm(dest, { recursive: true, force: true });
	}
}

export async function main(run = runPreCommit): Promise<number> {
	return run();
}

await runIfMain(import.meta, main);
