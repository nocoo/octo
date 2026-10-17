import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportIndex, L1_SCRIPTS, linkSnapshotDeps, main, runL1, runPreCommit } from "./pre-commit";

// The hook exports GIT_DIR/GIT_INDEX_FILE; fixture git calls must not touch the real repository.
for (const key of Object.keys(process.env)) {
	if (key.startsWith("GIT_")) delete process.env[key];
}

function git(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd });
}

async function fixtureRepo(): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "octo-precommit-"));
	git(repo, ["init"]);
	git(repo, ["config", "user.email", "octo@test"]);
	git(repo, ["config", "user.name", "octo"]);
	return repo;
}

describe("index snapshot", () => {
	it("lists the L1 scripts the hook must run", () => {
		expect(L1_SCRIPTS).toEqual([
			"typecheck",
			"lint",
			"gate:test-skip",
			"gate:no-remote",
			"gate:wrangler-vars",
			"test:coverage",
		]);
	});

	it("rejects a staged skip that is only fixed in the worktree", async () => {
		const repo = await fixtureRepo();
		try {
			writeFileSync(join(repo, "skip.ts"), `it.${"skip"}("x", () => {});\n`);
			git(repo, ["add", "skip.ts"]);
			writeFileSync(join(repo, "skip.ts"), "export {}\n");
			const dest = await mkdtemp(join(tmpdir(), "octo-index-out-"));
			try {
				exportIndex(repo, dest);
				exportIndex(repo, `${dest}/`);
				expect(readFileSync(join(dest, "skip.ts"), "utf8")).toContain("skip");
				expect(readFileSync(join(repo, "skip.ts"), "utf8")).toBe("export {}\n");
			} finally {
				await rm(dest, { recursive: true, force: true });
			}
			const code = await runPreCommit(repo, (cwd) => {
				const staged = readFileSync(join(cwd, "skip.ts"), "utf8");
				return staged.includes("skip") ? 1 : 0;
			});
			expect(code).toBe(1);
		} finally {
			await rm(repo, { recursive: true, force: true });
		}
	});

	it("returns the first failing L1 status", async () => {
		expect(runL1("/tmp", () => ({ status: 7 }))).toBe(7);
		expect(runL1("/tmp", () => ({ status: 0 }))).toBe(0);
		expect(runL1("/tmp", () => ({ status: null }))).toBe(1);
		expect(await main(async () => 0)).toBe(0);
	});

	it("links node_modules into the snapshot when present", async () => {
		const repo = await mkdtemp(join(tmpdir(), "octo-link-"));
		const dest = await mkdtemp(join(tmpdir(), "octo-link-dest-"));
		try {
			mkdirSync(join(repo, "node_modules"));
			linkSnapshotDeps(repo, dest);
			expect(existsSync(join(dest, "node_modules"))).toBe(true);
			linkSnapshotDeps(join(tmpdir(), "octo-missing-modules"), dest);
		} finally {
			await rm(repo, { recursive: true, force: true });
			await rm(dest, { recursive: true, force: true });
		}
	});
});
