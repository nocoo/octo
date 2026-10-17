import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureClientAssets, ensureDevVars } from "./ensure-dev-vars";
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
import { applyMigrations, assertTestMarker, createD1Exec, writeTestMarker } from "./local-d1";
import { L2_JWKS_PORT, L2_WORKER_PORT } from "./ports";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const localFlag = `--${"local"}`;
const remoteFlag = `--${"remote"}`;

export function assertLocalMode(args: string[]): void {
	if (args.includes(remoteFlag) || args.some((arg) => arg.startsWith(`${remoteFlag}=`))) {
		throw new Error("remote wrangler is forbidden");
	}
	if (!args.includes(localFlag)) {
		throw new Error("wrangler must run with --local");
	}
}

export function persistDir(runId: string, base = root): string {
	return join(base, ".wrangler/e2e", runId);
}

export function wranglerDevArgs(
	port: number,
	persistTo: string,
	config: string,
	envFile: string,
): string[] {
	const args = [
		"dev",
		localFlag,
		"--ip",
		"127.0.0.1",
		"--host",
		"127.0.0.1",
		"--local-upstream",
		"127.0.0.1",
		"--port",
		String(port),
		`--persist-to=${persistTo}`,
		`--config=${config}`,
		`--env-file=${envFile}`,
	];
	assertLocalMode(args);
	return args;
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
	return toml
		.replaceAll("port = 37059", `port = ${port}`)
		.replaceAll('directory = "./dist/client"', `directory = ${JSON.stringify(assetsDir)}`)
		.replaceAll('main = "apps/web/src/server/index.ts"', `main = ${JSON.stringify(mainPath)}`)
		.replace(/\n\[\[routes\]\]\npattern = "octo\.hexly\.ai"\ncustom_domain = true\n?/g, "\n");
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
			{ cwd: root, env: { ...process.env, ...env }, stdio: "inherit" },
		);
		child.on("exit", (code) => {
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

export async function stopChild(child: ChildProcess, sleeper = sleep): Promise<void> {
	if (child.exitCode !== null) {
		return;
	}
	const exited = new Promise<void>((resolve) => {
		child.once("exit", () => resolve());
	});
	child.kill("SIGTERM");
	await Promise.race([exited, sleeper(1_000)]);
	if (child.exitCode === null) {
		child.kill("SIGKILL");
		await exited;
	}
}

export function e2eEnvContents(jwksPort = L2_JWKS_PORT): string {
	const iss = l2AccessIss(jwksPort);
	return [
		"API_KEY_PEPPER=change-me-api-key-pepper",
		"ATTACHMENT_URL_SECRET=change-me-attachment-url-secret",
		"OCTO_SETTINGS_KEY=change-me-octo-settings-key",
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
	spawnWrangler?: (args: string[]) => ChildProcess;
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
	ensureDevVars(root);
	ensureClientAssets(join(tmp));
	const configPath = join(tmp, "wrangler.toml");
	const rootToml = await readFile(join(root, "wrangler.toml"), "utf8");
	const rewritten = rewriteWranglerConfig(
		rootToml,
		port,
		join(tmp, "dist/client"),
		join(root, "apps/web/src/server/index.ts"),
	);
	assertWranglerConfigLocal(rootToml);
	assertWranglerConfigLocal(rewritten);
	await writeFile(configPath, rewritten);
	const envFile = join(tmp, ".env");
	const jwksPort = options.jwksPort ?? L2_JWKS_PORT;
	await writeFile(envFile, e2eEnvContents(jwksPort));
	const state = await (options.generateJwks ?? generateJwksPair)();
	const jwksStatePath = join(tmp, "jwks-state.json");
	await writeFile(jwksStatePath, JSON.stringify(state));
	await (options.prepareDb ?? prepareE2eDb)(persistTo, configPath);
	const assertFree = options.assertFree ?? assertPortFree;
	await assertFree(port);
	await assertFree(jwksPort);
	const jwks = await (options.startJwks ?? startJwksStub)(jwksPort, state);
	const wranglerBin = join(root, "node_modules/.bin/wrangler");
	const args = wranglerDevArgs(port, persistTo, configPath, envFile);
	const wrangler =
		options.spawnWrangler?.(args) ??
		spawn(wranglerBin, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
	wrangler.stdout?.on("data", (chunk) => process.stdout.write(chunk as Buffer));
	wrangler.stderr?.on("data", (chunk) => process.stderr.write(chunk as Buffer));
	const base = `http://127.0.0.1:${port}`;
	try {
		await (options.wait ?? waitLive)(base, 60_000);
		const env = {
			OCTO_E2E: base,
			OCTO_PERSIST: persistTo,
			OCTO_CONFIG: configPath,
			OCTO_JWKS_STATE: jwksStatePath,
			OCTO_JWKS_PORT: String(jwksPort),
		};
		await (options.spawnVitest ?? spawnVitestProcess)(env);
		return 0;
	} finally {
		await stopChild(wrangler);
		await jwks.close();
	}
}
