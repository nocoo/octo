import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runIfMain } from "./cli";
import { bunDevSpawn, prepareDev, wranglerSidecarArgs } from "./dev";
import { DEV_WORKER_PORT } from "./ports";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function prepareServer(cwd = root): void {
	prepareDev(cwd);
}

export async function runDevServer(
	cwd = root,
	spawn: (cmd: string[], cwd: string) => { exited: Promise<number> },
	prepare = prepareServer,
	port = DEV_WORKER_PORT,
): Promise<number> {
	prepare(cwd);
	const wranglerBin = join(cwd, "node_modules/.bin/wrangler");
	const proc = spawn([wranglerBin, ...wranglerSidecarArgs(port, cwd)], cwd);
	return proc.exited;
}

export async function main(
	cwd = root,
	spawn: (cmd: string[], cwd: string) => { exited: Promise<number> } = bunDevSpawn,
	prepare = prepareServer,
	port = DEV_WORKER_PORT,
): Promise<number> {
	return runDevServer(cwd, spawn, prepare, port);
}

await runIfMain(import.meta, main);
