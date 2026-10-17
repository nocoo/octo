import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { ensureClientAssets } from "./ensure-dev-vars";
import { tomlHasRemoteBinding } from "./gate-no-remote";
import {
	generateJwksPair,
	type JwksState,
	type JwksStub,
	L2_ACCESS_AUD,
	l2AccessIss,
	l2JwksUrl,
	startJwksStub,
} from "./jwks-stub";
import { localWranglerConfig } from "./local-config";
import { applyMigrations, assertTestMarker, createD1Exec, writeTestMarker } from "./local-d1";
import { bundleWorker, miniflareOptions } from "./miniflare";
import { L2_JWKS_PORT, L2_WORKER_PORT } from "./ports";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function persistDir(runId: string, base = root): string {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(runId)) throw new Error("invalid L2 run id");
	return join(base, ".wrangler/e2e", runId);
}

export function assertWranglerConfigLocal(toml: string): void {
	if (tomlHasRemoteBinding(toml)) {
		throw new Error("wrangler config enables remote bindings");
	}
}

export function rewriteWranglerConfig(
	toml: string,
	port: number,
	assetsDir: string,
	mainPath: string,
): string {
	return localWranglerConfig(
		toml
			.replaceAll("port = 37059", `port = ${port}`)
			.replaceAll('directory = "./dist/client"', `directory = ${JSON.stringify(assetsDir)}`)
			.replaceAll('main = "apps/web/src/server/index.ts"', `main = ${JSON.stringify(mainPath)}`)
			.replace(/\n\[\[routes\]\]\npattern = "octo\.hexly\.ai"\ncustom_domain = true\n?/g, "\n"),
	);
}

export function occupyingPid(port: number): string {
	try {
		return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.filter(Boolean)
			.join(",");
	} catch {
		return "unknown";
	}
}

export function listenErrorCode(err: unknown): string {
	return err && typeof err === "object" && "code" in err
		? String((err as { code: unknown }).code)
		: "";
}

export function listenError(err: unknown, port: number): unknown {
	if (listenErrorCode(err) === "EADDRINUSE") {
		return new Error(`port ${port} already in use (pid ${occupyingPid(port)})`);
	}
	return err;
}

export async function assertPortFree(port: number): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const server = createServer();
		server.once("error", (err) => {
			reject(listenError(err, port));
		});
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolve());
		});
	});
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitLive(base: string, timeoutMs: number, sleeper = sleep): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${base}/api/live`);
			if (res.ok) {
				const body = (await res.json()) as { d1_marker?: string };
				if (body.d1_marker === "test") {
					return;
				}
			}
		} catch {
			// retry
		}
		await sleeper(200);
	}
	throw new Error("live poll timeout");
}

export function spawnVitestProcess(
	env: Record<string, string>,
	spawnFn: typeof spawn = spawn,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawnFn(
			join(root, "node_modules/.bin/vitest"),
			["run", "tests/api", "--config", "vitest.e2e.config.ts"],
			{ cwd: root, env: { ...process.env, ...env }, stdio: "inherit", detached: true },
		);
		const onSignal = (): void => {
			void stopChild(child);
		};
		process.on("SIGINT", onSignal);
		process.on("SIGTERM", onSignal);
		child.on("exit", (code) => {
			process.off("SIGINT", onSignal);
			process.off("SIGTERM", onSignal);
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`vitest exited ${code}`));
			}
		});
	});
}

export async function createExclusiveDir(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	try {
		await mkdir(path);
	} catch (err) {
		const code =
			err && typeof err === "object" && "code" in err
				? String((err as { code: unknown }).code)
				: "";
		if (code === "EEXIST") {
			throw new Error(`persist dir already exists: ${path}`);
		}
		throw err;
	}
}

export async function prepareE2eDb(
	persistTo: string,
	config: string,
	execFactory: typeof createD1Exec = createD1Exec,
): Promise<void> {
	await createExclusiveDir(persistTo);
	const d1 = execFactory(join(root, "node_modules/.bin/wrangler"), root, persistTo, config);
	writeTestMarker(d1);
	assertTestMarker(d1);
	applyMigrations(d1);
}

export function stopProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
	if (pid === undefined || pid <= 0) {
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// already gone
		}
	}
}

const stoppingChildren = new WeakMap<ChildProcess, Promise<void>>();

function childExited(child: ChildProcess): boolean {
	return child.exitCode != null || child.signalCode != null;
}

export async function stopChild(child: ChildProcess, sleeper = sleep): Promise<void> {
	const inflight = stoppingChildren.get(child);
	if (inflight) {
		return inflight;
	}
	const work = (async () => {
		if (childExited(child)) {
			return;
		}
		const exited = new Promise<void>((resolve) => {
			child.once("exit", () => resolve());
		});
		stopProcessGroup(child.pid, "SIGTERM");
		child.kill("SIGTERM");
		await Promise.race([exited, sleeper(1_000)]);
		if (!childExited(child)) {
			stopProcessGroup(child.pid, "SIGKILL");
			child.kill("SIGKILL");
			await exited;
		}
	})();
	stoppingChildren.set(child, work);
	try {
		await work;
	} finally {
		stoppingChildren.delete(child);
	}
}

export function e2eEnvContents(jwksPort = L2_JWKS_PORT, workerPort = L2_WORKER_PORT): string {
	const iss = l2AccessIss(jwksPort);
	return [
		"API_KEY_PEPPER=change-me-api-key-pepper",
		"ATTACHMENT_URL_SECRET=change-me-attachment-url-secret",
		`ATTACHMENT_URL_HOST=http://127.0.0.1:${workerPort}`,
		`OCTO_SETTINGS_KEY=${Buffer.alloc(32, 0x42).toString("base64")}`,
		"RESOURCE_ENV=test",
		`CF_ACCESS_TEAM_DOMAIN=${iss}`,
		`CF_ACCESS_AUD=${L2_ACCESS_AUD}`,
		`ACCESS_JWKS_URL=${l2JwksUrl(jwksPort)}`,
		"",
	].join("\n");
}

export type RunE2eOptions = {
	runId?: string;
	port?: number;
	jwksPort?: number;
	spawnVitest?: (env: Record<string, string>) => Promise<void>;
	createRuntime?: (options: MiniflareOptions) => Pick<Miniflare, "ready" | "dispose">;
	bundle?: typeof bundleWorker;
	prepareDb?: (persistTo: string, config: string) => Promise<void>;
	wait?: (base: string, timeoutMs: number) => Promise<void>;
	assertFree?: (port: number) => Promise<void>;
	generateJwks?: () => Promise<JwksState>;
	startJwks?: (port: number, state: JwksState) => Promise<JwksStub>;
};

export async function runE2eApi(options: RunE2eOptions = {}): Promise<number> {
	const runId = options.runId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const port = options.port ?? L2_WORKER_PORT;
	const persistTo = persistDir(runId);
	const tmp = join(root, ".wrangler/e2e-run", runId);
	await mkdir(join(tmp, "dist/client"), { recursive: true });
	ensureClientAssets(join(tmp));
	const configPath = join(tmp, "wrangler.toml");
	const rootToml = await readFile(join(root, "wrangler.toml"), "utf8");
	const rewritten = rewriteWranglerConfig(
		rootToml,
		port,
		join(tmp, "dist/client"),
		join(root, "tests/fixtures/worker.ts"),
	);
	assertWranglerConfigLocal(rootToml);
	assertWranglerConfigLocal(rewritten);
	await writeFile(configPath, rewritten);
	const envFile = join(tmp, ".env");
	const jwksPort = options.jwksPort ?? L2_JWKS_PORT;
	await writeFile(envFile, e2eEnvContents(jwksPort, port));
	const state = await (options.generateJwks ?? generateJwksPair)();
	const jwksStatePath = join(tmp, "jwks-state.json");
	await writeFile(jwksStatePath, JSON.stringify(state));
	await (options.prepareDb ?? prepareE2eDb)(persistTo, configPath);
	const assertFree = options.assertFree ?? assertPortFree;
	await assertFree(port);
	await assertFree(jwksPort);
	const jwks = await (options.startJwks ?? startJwksStub)(jwksPort, state);
	const base = `http://127.0.0.1:${port}`;
	let runtime: Pick<Miniflare, "ready" | "dispose"> | undefined;
	let stopping: Promise<void> | undefined;
	let interrupted = false;
	const cleanup = (): Promise<void> => {
		stopping ??= (async () => {
			try {
				await runtime?.dispose();
			} finally {
				await jwks.close();
			}
		})();
		return stopping;
	};
	const onSignal = (): void => {
		interrupted = true;
		void cleanup().catch(() => {
			process.exitCode = 1;
		});
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	try {
		const script = await (options.bundle ?? bundleWorker)(join(root, "tests/fixtures/worker.ts"));
		if (interrupted) throw new Error("L2 interrupted");
		const config = miniflareOptions(
			rewritten,
			persistTo,
			script,
			parseEnv(e2eEnvContents(jwksPort, port)),
		);
		runtime = (options.createRuntime ?? ((config) => new Miniflare(config)))(config);
		await runtime.ready;
		await (options.wait ?? waitLive)(base, 60_000);
		if (interrupted) throw new Error("L2 interrupted");
		const env = {
			OCTO_E2E: base,
			OCTO_PERSIST: persistTo,
			OCTO_CONFIG: configPath,
			OCTO_JWKS_STATE: jwksStatePath,
			OCTO_JWKS_PORT: String(jwksPort),
		};
		await (options.spawnVitest ?? spawnVitestProcess)(env);
		if (interrupted) throw new Error("L2 interrupted");
		return 0;
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		await cleanup();
	}
}
