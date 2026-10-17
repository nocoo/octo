import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runIfMain } from "./cli";
import {
	assertPortFree,
	assertWranglerConfigLocal,
	createExclusiveDir,
	e2eEnvContents,
	prepareE2eDb,
	rewriteWranglerConfig,
	root,
	stopChild,
	waitLive,
} from "./e2e";
import { generateJwksPair, startJwksStub } from "./jwks-stub";
import { L3_WORKER_PORT } from "./ports";

export function bddPaths(runId: string, base = root) {
	if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("invalid L3 run ID");
	return {
		persist: join(base, ".wrangler/e2e-pw", runId),
		run: join(base, ".wrangler/e2e-pw-run", runId),
		artifacts: join(base, "test-results/l3", runId),
	};
}

export function runCommand(
	bin: string,
	args: string[],
	env: Record<string, string>,
	cwd: string,
	spawnFn = spawn,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawnFn(join(cwd, "node_modules/.bin", bin), args, {
			cwd,
			env: { ...process.env, ...env },
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${bin} exited ${code}`));
		});
	});
}

export type RunBddOptions = {
	root?: string;
	runId?: string;
	command?: typeof runCommand;
	assertFree?: typeof assertPortFree;
	prepareDb?: typeof prepareE2eDb;
	generateJwks?: typeof generateJwksPair;
	startJwks?: typeof startJwksStub;
	startWorker?: (args: string[], env: NodeJS.ProcessEnv) => ChildProcess;
	wait?: typeof waitLive;
};

export async function runE2eBdd(options: RunBddOptions = {}): Promise<number> {
	const cwd = options.root ?? root;
	const paths = bddPaths(options.runId ?? randomUUID(), cwd);
	const toml = await readFile(join(cwd, "wrangler.toml"), "utf8");
	assertWranglerConfigLocal(toml);
	await createExclusiveDir(paths.run);
	const config = join(paths.run, "wrangler.toml");
	const assets = join(paths.run, "client");
	const localConfig = rewriteWranglerConfig(
		toml,
		L3_WORKER_PORT,
		assets,
		join(cwd, "apps/web/src/server/index.ts"),
	);
	assertWranglerConfigLocal(localConfig);
	await writeFile(config, localConfig);
	const envFile = join(paths.run, ".env");
	const command = options.command ?? runCommand;
	await command("vite", ["build", "--outDir", assets], {}, cwd);
	await (options.prepareDb ?? prepareE2eDb)(paths.persist, config);
	const assertFree = options.assertFree ?? assertPortFree;
	await assertFree(L3_WORKER_PORT);
	const state = await (options.generateJwks ?? generateJwksPair)();
	const statePath = join(paths.run, "jwks-state.json");
	await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
	const jwks = await (options.startJwks ?? startJwksStub)(0, state);
	let worker: ChildProcess | undefined;
	let interrupted = false;
	const stop = async (): Promise<void> => {
		if (worker && worker.pid !== undefined) await stopChild(worker);
	};
	const onSignal = (): void => {
		interrupted = true;
		void stop();
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	try {
		const jwksUrl = new URL(jwks.url);
		const jwksPort = Number(jwksUrl.port);
		if (jwksUrl.protocol !== "http:" || jwksUrl.hostname !== "127.0.0.1" || jwksPort <= 0) {
			throw new Error("expected an allocated local JWKS port");
		}
		await writeFile(envFile, e2eEnvContents(jwksPort, L3_WORKER_PORT));
		const args = [
			"dev",
			"--local",
			"--ip",
			"127.0.0.1",
			"--port",
			String(L3_WORKER_PORT),
			`--persist-to=${paths.persist}`,
			`--config=${config}`,
			`--env-file=${envFile}`,
		];
		const env = { ...process.env, WRANGLER_DISABLE_REQUEST_BODY_DRAINING: "true" };
		worker = options.startWorker
			? options.startWorker(args, env)
			: spawn(join(cwd, "node_modules/.bin/wrangler"), args, {
					cwd,
					env,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});
		worker.stdout?.on("data", (chunk) => process.stdout.write(chunk as Buffer));
		worker.stderr?.on("data", (chunk) => process.stderr.write(chunk as Buffer));
		const started = worker;
		const startupFailure = new Promise<never>((_resolve, reject) => {
			started.once("error", reject);
		});
		const base = `http://127.0.0.1:${L3_WORKER_PORT}`;
		await Promise.race([startupFailure, (options.wait ?? waitLive)(base, 60_000)]);
		if (interrupted) throw new Error("L3 interrupted");
		await mkdir(paths.artifacts, { recursive: true });
		await writeFile(join(paths.artifacts, "run.json"), JSON.stringify({ base, ...paths }, null, 2));
		console.log(`L3 artifacts: ${paths.artifacts}`);
		await command(
			"playwright",
			["test", "--config", "playwright.config.ts"],
			{
				OCTO_E2E: base,
				OCTO_PERSIST: paths.persist,
				OCTO_CONFIG: config,
				OCTO_JWKS_STATE: statePath,
				OCTO_JWKS_PORT: String(jwksPort),
				OCTO_L3_ARTIFACTS: paths.artifacts,
			},
			cwd,
		);
		return 0;
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		try {
			await stop();
		} finally {
			await jwks.close();
		}
	}
}

export async function main(run = runE2eBdd): Promise<number> {
	return run();
}

await runIfMain(import.meta, main);
