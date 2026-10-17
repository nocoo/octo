import { spawn } from "node:child_process";
import { runIfMain } from "./cli";

export type SpawnResult = { exitCode: number; stdout: string; stderr: string };

export type SpawnFn = (cmd: string[]) => Promise<SpawnResult>;

export async function runNamed(cmd: string[], label: string, spawn: SpawnFn): Promise<boolean> {
	try {
		const result = await spawn(cmd);
		if (result.exitCode !== 0) {
			console.error(`\n${label} FAILED (exit ${result.exitCode}):`);
			if (result.stdout) process.stdout.write(result.stdout);
			if (result.stderr) process.stderr.write(result.stderr);
			return false;
		}
		console.log(`${label}: passed`);
		return true;
	} catch {
		console.error(`${label}: tool not installed.`);
		return false;
	}
}

export function gitleaksRanges(arg: string | undefined, envRanges: string | undefined): string[] {
	if (arg === "--deps") {
		return [];
	}
	return (envRanges ?? "origin/main..HEAD").trim().split(/\s+/).filter(Boolean);
}

export function securityTasks(
	arg: string | undefined,
	ranges: string[],
): Array<{ cmd: string[]; label: string }> {
	const tasks: Array<{ cmd: string[]; label: string }> = [];
	if (arg !== "--deps") {
		for (const range of ranges) {
			tasks.push({
				cmd: [
					"gitleaks",
					"detect",
					"--no-banner",
					"--redact",
					"--config=.gitleaks.toml",
					`--log-opts=${range}`,
				],
				label: `gitleaks ${range}`,
			});
		}
	}
	if (arg !== "--secrets") {
		tasks.push({ cmd: ["osv-scanner", "--lockfile=bun.lock"], label: "osv-scanner" });
	}
	return tasks;
}

export async function runGateSecurity(
	arg: string | undefined,
	envRanges: string | undefined,
	spawn: SpawnFn,
): Promise<number> {
	const tasks = securityTasks(arg, gitleaksRanges(arg, envRanges));
	const results = await Promise.all(tasks.map((task) => runNamed(task.cmd, task.label, spawn)));
	if (!results.every(Boolean)) {
		return 1;
	}
	console.log("gate:security passed");
	return 0;
}

export function gitleaksDetectArgs(source: string, config: string): string[] {
	return [
		"gitleaks",
		"detect",
		"--no-banner",
		"--redact",
		"--no-git",
		`--source=${source}`,
		`--config=${config}`,
	];
}

export function bunSpawn(cmd: string[]): Promise<SpawnResult> {
	const [bin, ...args] = cmd;
	if (!bin) {
		return Promise.resolve({ exitCode: 1, stdout: "", stderr: "missing command" });
	}
	return new Promise((resolve) => {
		const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		proc.stdout?.on("data", (chunk) => stdout.push(chunk as Buffer));
		proc.stderr?.on("data", (chunk) => stderr.push(chunk as Buffer));
		proc.on("error", (err) => {
			resolve({ exitCode: 1, stdout: "", stderr: err.message });
		});
		proc.on("close", (code) => {
			resolve({
				exitCode: code ?? 1,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
	});
}

export async function main(
	arg = process.argv[2],
	envRanges = process.env.GITLEAKS_LOG_OPTS,
	spawn: SpawnFn = bunSpawn,
): Promise<number> {
	return runGateSecurity(arg, envRanges, spawn);
}

await runIfMain(import.meta, main);
