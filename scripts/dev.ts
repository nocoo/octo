import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runIfMain } from "./cli";
import { ensureClientAssets, ensureDevVars } from "./ensure-dev-vars";
import { ensureLocalSchema } from "./local-d1";
import { DEV_VITE_PORT, DEV_WORKER_PORT } from "./ports";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export type Spawned = { exited: Promise<number>; kill: () => void };

export type DevSpawn = (cmd: string[], cwd: string) => Spawned;

export function wranglerSidecarArgs(port = DEV_WORKER_PORT): string[] {
	return ["dev", `--${"local"}`, "--port", String(port)];
}

export function viteArgs(port = DEV_VITE_PORT): string[] {
	return ["--port", String(port), "--strictPort"];
}

export function prepareDev(cwd = root): void {
	ensureDevVars(cwd);
	ensureClientAssets(cwd);
	ensureLocalSchema();
}

export async function runDev(cwd = root, spawn: DevSpawn, prepare = prepareDev): Promise<number> {
	prepare(cwd);
	const wranglerBin = join(cwd, "node_modules/.bin/wrangler");
	const viteBin = join(cwd, "node_modules/.bin/vite");
	const wrangler = spawn([wranglerBin, ...wranglerSidecarArgs()], cwd);
	const vite = spawn([viteBin, ...viteArgs()], cwd);
	const stop = (): void => {
		wrangler.kill();
		vite.kill();
	};
	const code = await Promise.race([wrangler.exited, vite.exited]);
	stop();
	return code ?? 1;
}

export function bunDevSpawn(cmd: string[], cwd: string): Spawned {
	const [bin, ...args] = cmd;
	const proc = spawn(bin ?? "false", args, { cwd, stdio: "inherit" });
	return {
		exited: new Promise((resolve) => {
			proc.on("close", (code) => resolve(code ?? 1));
		}),
		kill: () => {
			proc.kill();
		},
	};
}

export async function main(
	cwd = root,
	spawn: DevSpawn = bunDevSpawn,
	prepare = prepareDev,
): Promise<number> {
	return runDev(cwd, spawn, prepare);
}

await runIfMain(import.meta, main);
