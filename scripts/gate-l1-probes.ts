import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIfMain } from "./cli";
import { assertNodeRuntime } from "./node-runtime";
import { linkSnapshotDeps } from "./pre-commit";

export type ProbeOutcome = {
	name: string;
	expectReject: boolean;
	exitCode: number;
	ms: number;
};

function git(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "pipe" });
}

export function resetTree(cwd: string): void {
	git(cwd, ["reset", "--hard", "HEAD"]);
	git(cwd, ["clean", "-fd", "-e", "node_modules", "-e", "apps/web/node_modules"]);
}

function ensureHookLauncher(cwd: string): void {
	const hook = join(cwd, ".husky/pre-commit");
	if (existsSync(hook)) {
		chmodSync(hook, 0o755);
	}
}

export async function createProbeRepo(sourceRepo: string): Promise<{ root: string; repo: string }> {
	const root = await mkdtemp(join(tmpdir(), "octo-l1-probe-"));
	const repo = join(root, "repo");
	execFileSync("git", ["clone", "--no-hardlinks", "--local", sourceRepo, repo], {
		stdio: "pipe",
	});
	git(repo, ["config", "user.email", "l1-probe@octo.test"]);
	git(repo, ["config", "user.name", "l1-probe"]);
	git(repo, ["config", "core.hooksPath", ".husky"]);
	linkSnapshotDeps(sourceRepo, repo);
	ensureHookLauncher(repo);
	return { root, repo };
}

export function runPreCommitHookAsync(
	repo: string,
	opts: { env?: NodeJS.ProcessEnv; signalAfterMs?: number } = {},
): Promise<{ status: number; signal: NodeJS.Signals | null; ms: number }> {
	const start = Date.now();
	const child = spawn("bun", ["run", "scripts/pre-commit.ts"], {
		cwd: repo,
		stdio: "ignore",
		env: { ...process.env, ...opts.env },
	});
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (opts.signalAfterMs !== undefined) {
			timer = setTimeout(() => child.kill("SIGTERM"), opts.signalAfterMs);
		}
		const finish = (status: number, signal: NodeJS.Signals | null) => {
			if (timer) clearTimeout(timer);
			resolve({ status, signal, ms: Date.now() - start });
		};
		child.on("error", () => finish(1, null));
		child.on("close", (status, signal) => {
			finish(status === null ? 1 : status, signal);
		});
	});
}

export function stageFile(repo: string, relative: string, body: string): void {
	const path = join(repo, relative);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, body);
	git(repo, ["add", relative]);
}

export function stageAndWorktreeMismatch(repo: string): void {
	const relative = "scripts/l1-probe-skip-staged.ts";
	stageFile(repo, relative, `it.${"skip"}("staged", () => {});\n`);
	writeFileSync(join(repo, relative), "export {}\n");
}

function evaluate(outcome: ProbeOutcome): boolean {
	const rejected = outcome.exitCode !== 0;
	return outcome.expectReject ? rejected : !rejected;
}

async function runProbe(
	repo: string,
	name: string,
	expectReject: boolean,
	prepare: () => void | Promise<void>,
): Promise<ProbeOutcome> {
	resetTree(repo);
	await prepare();
	const { status, ms } = await runPreCommitHookAsync(repo);
	return { name, expectReject, exitCode: status, ms };
}

export async function runL1Probes(sourceRepo: string): Promise<number> {
	const { root, repo } = await createProbeRepo(sourceRepo);
	const outcomes: ProbeOutcome[] = [];
	try {
		outcomes.push(
			await runProbe(repo, "lint-error", true, () => {
				stageFile(repo, "scripts/l1-probe-lint.ts", "const oops = ");
			}),
		);
		outcomes.push(
			await runProbe(repo, "staged-skip-worktree-clean", true, () => {
				stageAndWorktreeMismatch(repo);
			}),
		);
		resetTree(repo);
		const missingBunStart = Date.now();
		const missingBun = spawnSync("bun", ["run", "scripts/pre-commit.ts"], {
			cwd: repo,
			stdio: "ignore",
			env: { ...process.env, PATH: "/usr/bin:/bin" },
		});
		outcomes.push({
			name: "missing-bun",
			expectReject: true,
			exitCode: missingBun.error || missingBun.status !== 0 ? 1 : 0,
			ms: Date.now() - missingBunStart,
		});

		resetTree(repo);
		const interrupted = await runPreCommitHookAsync(repo, { signalAfterMs: 400 });
		outcomes.push({
			name: "interrupt",
			expectReject: true,
			exitCode: interrupted.status,
			ms: interrupted.ms,
		});

		const failed = outcomes.filter((o) => !evaluate(o));
		for (const outcome of outcomes) {
			const verb = outcome.expectReject ? "reject" : "accept";
			const mark = failed.some((f) => f.name === outcome.name) ? "FAIL" : "ok";
			console.log(
				`${mark} ${outcome.name}: exit=${outcome.exitCode} ms=${outcome.ms} (expect ${verb})`,
			);
		}
		if (failed.length > 0) {
			return 1;
		}
		console.log("gate:l1-probes passed");
		return 0;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

export async function main(): Promise<number> {
	const runtime = assertNodeRuntime();
	if (runtime !== 0) {
		return runtime;
	}
	return runL1Probes(process.cwd());
}

await runIfMain(import.meta, main);
