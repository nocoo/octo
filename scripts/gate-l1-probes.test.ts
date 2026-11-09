import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stageAndWorktreeMismatch, stageFile } from "./gate-l1-probes";
import { exportIndex } from "./pre-commit";

function git(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd });
}

describe("gate:l1-probes helpers", () => {
	it("stages a skip that stays broken in the index after a worktree fix", async () => {
		const repo = await mkdtemp(join(tmpdir(), "octo-l1-helper-"));
		git(repo, ["init"]);
		git(repo, ["config", "user.email", "octo@test"]);
		git(repo, ["config", "user.name", "octo"]);
		writeFileSync(join(repo, "probe.ts"), "export {}\n");
		git(repo, ["add", "probe.ts"]);
		git(repo, ["commit", "-m", "seed"]);
		stageAndWorktreeMismatch(repo);
		const dest = await mkdtemp(join(tmpdir(), "octo-l1-helper-out-"));
		try {
			exportIndex(repo, dest);
			expect(readFileSync(join(dest, "scripts/l1-probe-skip-staged.ts"), "utf8")).toContain("skip");
			expect(readFileSync(join(repo, "scripts/l1-probe-skip-staged.ts"), "utf8")).toBe(
				"export {}\n",
			);
		} finally {
			await rm(dest, { recursive: true, force: true });
			await rm(repo, { recursive: true, force: true });
		}
	});

	it("writes staged fixture files", async () => {
		const repo = await mkdtemp(join(tmpdir(), "octo-l1-stage-"));
		git(repo, ["init"]);
		git(repo, ["config", "user.email", "octo@test"]);
		git(repo, ["config", "user.name", "octo"]);
		try {
			stageFile(repo, "note.ts", "export const note = 1;\n");
			exportIndex(repo, `${repo}/snap/`);
			expect(readFileSync(join(repo, "snap/note.ts"), "utf8")).toContain("note");
		} finally {
			await rm(repo, { recursive: true, force: true });
		}
	});
});
