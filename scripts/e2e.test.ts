import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it, vi } from "vitest";
import {
	assertPortFree,
	assertWranglerConfigLocal,
	createExclusiveDir,
	e2eEnvContents,
	listenError,
	listenErrorCode,
	occupyingPid,
	persistDir,
	prepareE2eDb,
	rewriteWranglerConfig,
	root,
	runE2eApi,
	spawnVitestProcess,
	stopChild,
	stopProcessGroup,
	waitLive,
} from "./e2e";

describe("e2e helpers", () => {
	it.each(["", "..", "../state", "/tmp/shared", "run/nested"])(
		"rejects unsafe run id %s",
		(runId) => {
			expect(() => persistDir(runId, "/repo")).toThrow("run id");
		},
	);
	it("builds persist paths and rewrites wrangler config", () => {
		expect(persistDir("abc", "/repo")).toBe("/repo/.wrangler/e2e/abc");
		const rewritten = rewriteWranglerConfig(
			[
				"[dev]",
				"port = 37059",
				'directory = "./dist/client"',
				'main = "apps/web/src/server/index.ts"',
				"",
				"[[routes]]",
				'pattern = "octo.hexly.ai"',
				"custom_domain = true",
				"",
			].join("\n"),
			17059,
			"/tmp/assets",
			"/repo/apps/web/src/server/index.ts",
		);
		expect(rewritten).toContain("port = 17059");
		expect(rewritten).toContain("/tmp/assets");
		expect(rewritten).not.toContain("octo.hexly.ai");
		expect(e2eEnvContents(17057)).toContain("ATTACHMENT_URL_HOST=http://127.0.0.1:17059");
		expect(e2eEnvContents(17057, 18059)).toContain("ATTACHMENT_URL_HOST=http://127.0.0.1:18059");
		expect(e2eEnvContents(17057)).toContain("RESOURCE_ENV=test");
		expect(e2eEnvContents(17057)).toContain("OCTO_VECTOR_SYNC_PARALLEL=1");
		const settingsKey = e2eEnvContents(17057).match(/^OCTO_SETTINGS_KEY=(.+)$/m)?.[1] ?? "";
		expect(Buffer.from(settingsKey, "base64").length).toBe(32);
		expect(e2eEnvContents(17057)).toContain("http://127.0.0.1:17057/cdn-cgi/access/certs");
		expect(() => assertWranglerConfigLocal("name = 'octo'\n")).not.toThrow();
		expect(() => assertWranglerConfigLocal(`[[d1_databases]]\nremote${"=true"}\n`)).toThrow(
			"remote",
		);
		expect(() => assertWranglerConfigLocal(`[[d1_databases]]\n"remote"${" = true"}\n`)).toThrow(
			"remote",
		);
		expect(() => assertWranglerConfigLocal(`[[d1_databases]]\n'remote'${" = true"}\n`)).toThrow(
			"remote",
		);
	});

	it("waitLive succeeds on d1_marker=test and times out otherwise", async () => {
		let mode: "down" | "ok" | "fail" = "down";
		vi.stubGlobal("fetch", async () => {
			if (mode === "down") {
				throw new Error("down");
			}
			if (mode === "ok") {
				return new Response(JSON.stringify({ d1_marker: "test" }), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 500 });
		});
		await expect(waitLive("http://127.0.0.1:9", 10, async () => undefined)).rejects.toThrow(
			"timeout",
		);
		mode = "ok";
		await waitLive("http://127.0.0.1:9", 1000, async () => undefined);
		mode = "fail";
		await expect(waitLive("http://127.0.0.1:9", 10, async () => undefined)).rejects.toThrow(
			"timeout",
		);
	});

	it("assertPortFree rejects a bound port", async () => {
		const server = createServer();
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
		const addr = server.address();
		if (!addr || typeof addr === "string") {
			server.close();
			throw new Error("no port");
		}
		await expect(assertPortFree(addr.port)).rejects.toThrow("already in use");
		expect(occupyingPid(addr.port).length).toBeGreaterThan(0);
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await assertPortFree(addr.port);
	});

	it("maps listen errors for occupied and other failures", () => {
		expect(listenErrorCode("x")).toBe("");
		expect(listenErrorCode({ code: "EADDRINUSE" })).toBe("EADDRINUSE");
		expect(String(listenError({ code: "EADDRINUSE" }, 9))).toContain("already in use");
		expect(listenError("boom", 9)).toBe("boom");
		expect(listenErrorCode(null)).toBe("");
	});

	it("prepares the e2e db with a stub executor", async () => {
		const persistTo = join(tmpdir(), `octo-prep-${Date.now()}`);
		const commands: string[] = [];
		let markerWrites = 0;
		const exec = (args: string[]): string => {
			commands.push(args.join(" "));
			if (args.some((arg) => arg.includes("INSERT") && arg.includes("_test_marker"))) {
				markerWrites += 1;
			}
			if (args.includes("--json") && args.some((arg) => arg.includes("sqlite_master"))) {
				return JSON.stringify([{ results: [{ name: "spaces" }] }]);
			}
			if (args.includes("--json") && args.some((arg) => arg.includes("_test_marker"))) {
				return JSON.stringify([{ results: markerWrites > 0 ? [{ value: "test" }] : [] }]);
			}
			if (args.includes("--json")) {
				return JSON.stringify([{ results: [{ value: "test" }] }]);
			}
			return "";
		};
		try {
			await prepareE2eDb(persistTo, "cfg.toml", () => exec);
			const markerAt = commands.findIndex((cmd) => cmd.includes("_test_marker"));
			const migrateAt = commands.findIndex(
				(cmd) => cmd.includes("sqlite_master") || cmd.includes("--file="),
			);
			expect(markerAt).toBeGreaterThanOrEqual(0);
			expect(migrateAt).toBeGreaterThan(markerAt);
			await expect(prepareE2eDb(persistTo, "cfg.toml", () => exec)).rejects.toThrow(
				"already exists",
			);
			const occupied = join(tmpdir(), `octo-prep-exists-${Date.now()}`);
			await mkdir(occupied);
			await expect(prepareE2eDb(occupied, "cfg.toml", () => exec)).rejects.toThrow(
				"already exists",
			);
			await rm(occupied, { recursive: true, force: true });
			const blocked = join(tmpdir(), `octo-prep-file-${Date.now()}`);
			await writeFile(blocked, "x");
			await expect(createExclusiveDir(join(blocked, "child"))).rejects.toThrow();
			await rm(blocked);
		} finally {
			await rm(persistTo, { recursive: true, force: true });
		}
	});
});

describe("runE2eApi", () => {
	it.each(["bundle", "construct", "ready", "live", "vitest", "dispose", "signal"])(
		"closes owned resources on %s failure",
		async (stage) => {
			const close = vi.fn(async () => undefined);
			const dispose = vi.fn(async () => {
				if (stage === "dispose") throw new Error("dispose failed");
			});
			const vitest = vi.fn(async () => {
				if (stage === "vitest") throw new Error("vitest failed");
			});
			const create = vi.fn(() => {
				if (stage === "construct") throw new Error("construct failed");
				return {
					ready:
						stage === "ready"
							? Promise.reject(new Error("ready failed"))
							: Promise.resolve(new URL("http://127.0.0.1")),
					dispose,
				};
			});
			const beforeSignals = process.listenerCount("SIGTERM");
			await expect(
				runE2eApi({
					prepareDb: async () => undefined,
					assertFree: async () => undefined,
					generateJwks: async () => ({
						kid: "e2e",
						publicJwk: { kty: "RSA", kid: "e2e" },
						privateJwk: { kty: "RSA" },
					}),
					startJwks: async () => ({ url: "http://127.0.0.1", close }),
					bundle: async () => {
						if (stage === "bundle") throw new Error("bundle failed");
						if (stage === "signal") process.emit("SIGTERM");
						return "export default {}";
					},
					createRuntime: create,
					wait: async () => {
						if (stage === "live") throw new Error("live failed");
					},
					spawnVitest: vitest,
				}),
			).rejects.toThrow(stage === "signal" ? "interrupted" : `${stage} failed`);
			expect(close).toHaveBeenCalledTimes(1);
			expect(dispose).toHaveBeenCalledTimes(
				["bundle", "construct", "signal"].includes(stage) ? 0 : 1,
			);
			expect(process.listenerCount("SIGTERM")).toBe(beforeSignals);
			if (stage === "signal") expect(create).not.toHaveBeenCalled();
		},
	);
	it("starts direct Miniflare, runs vitest, and disposes the runtime", async () => {
		const child = new EventEmitter() as ChildProcess & EventEmitter & { exitCode: number | null };
		Object.defineProperty(child, "exitCode", { writable: true, value: null });
		child.stdout = new EventEmitter() as ChildProcess["stdout"];
		child.stderr = new EventEmitter() as ChildProcess["stderr"];
		child.kill = ((signal?: NodeJS.Signals) => {
			Object.defineProperty(child, "exitCode", {
				writable: true,
				value: signal === "SIGKILL" ? 1 : 0,
			});
			child.emit("exit", child.exitCode);
			return true;
		}) as ChildProcess["kill"];
		const vitest = vi.fn<(env: Record<string, string>) => Promise<void>>(async () => undefined);
		const jwksClosed: boolean[] = [];
		const dispose = vi.fn(async () => undefined);
		const code = await runE2eApi({
			bundle: async () => "export default {}",
			port: 18059,
			prepareDb: async () => undefined,
			assertFree: async () => undefined,
			wait: async () => undefined,
			generateJwks: async () => ({
				kid: "e2e",
				privateJwk: { kty: "RSA" },
				publicJwk: { kty: "RSA", kid: "e2e" },
			}),
			startJwks: async () => ({
				url: "http://127.0.0.1:17057/cdn-cgi/access/certs",
				close: async () => {
					jwksClosed.push(true);
				},
			}),
			createRuntime: (options) => {
				expect(options.workers[0]?.dev?.unsafeDirectSockets).toEqual([
					{ host: "127.0.0.1", port: 18059 },
				]);
				expect(options.host).toBe("127.0.0.1");
				expect(options.resourcePersistencePath).toContain(".wrangler/e2e/");
				return { ready: Promise.resolve(new URL("http://127.0.0.1:18059")), dispose };
			},
			spawnVitest: vitest,
		});
		expect(code).toBe(0);
		expect(vitest).toHaveBeenCalled();
		expect(vitest.mock.calls.at(0)?.[0]).toMatchObject({
			OCTO_JWKS_PORT: "17057",
		});
		const generatedPath = vitest.mock.calls[0]?.[0].OCTO_CONFIG as string;
		const generated = parse(await readFile(generatedPath, "utf8"));
		expect(generated.vectorize).toBeUndefined();
		expect(generated.main).toBe(join(root, "tests/fixtures/worker.ts"));
		expect(generated.assets).toMatchObject({
			directory: join(dirname(generatedPath), "dist/client"),
			binding: "ASSETS",
		});
		expect(generated.d1_databases).toEqual(
			parse(await readFile(join(root, "wrangler.toml"), "utf8")).d1_databases,
		);
		expect(parse(await readFile(join(root, "wrangler.toml"), "utf8")).vectorize).toEqual([
			{ binding: "VEC", index_name: "octo-vec-te3-small-1536", remote: false },
		]);
		const configPath = vitest.mock.calls[0]?.[0].OCTO_CONFIG;
		expect(configPath).toBeDefined();
		expect(await readFile(join(dirname(configPath ?? ""), ".env"), "utf8")).toContain(
			"ATTACHMENT_URL_HOST=http://127.0.0.1:18059",
		);
		expect(vitest.mock.calls[0]?.[0].OCTO_E2E).toBe("http://127.0.0.1:18059");
		expect(jwksClosed).toEqual([true]);
		expect(dispose).toHaveBeenCalledTimes(1);
		const livePort = await new Promise<number>((resolve, reject) => {
			const server = createServer();
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				server.close(() => {
					if (!addr || typeof addr === "string") {
						reject(new Error("no port"));
						return;
					}
					resolve(addr.port);
				});
			});
		});
		expect(
			await runE2eApi({
				bundle: async () => "export default {}",
				jwksPort: livePort,
				prepareDb: async () => undefined,
				assertFree: async () => undefined,
				wait: async () => undefined,
				createRuntime: () => ({ ready: Promise.resolve(new URL("http://127.0.0.1")), dispose }),
				spawnVitest: async () => undefined,
			}),
		).toBe(0);
		await stopChild(child);
		Object.defineProperty(child, "exitCode", { writable: true, value: 0 });
		await stopChild(child);
		expect(occupyingPid(1)).toBe("unknown");
	});

	it("kills only this run's process group", () => {
		stopProcessGroup(undefined, "SIGTERM");
		stopProcessGroup(0, "SIGTERM");
		const killed: Array<[number, string]> = [];
		const spy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string) => {
			killed.push([pid, String(signal)]);
			if (pid < 0) {
				throw new Error("esrch");
			}
			return true;
		}) as typeof process.kill);
		stopProcessGroup(42, "SIGTERM");
		expect(killed).toEqual([
			[-42, "SIGTERM"],
			[42, "SIGTERM"],
		]);
		spy.mockImplementation((() => {
			throw new Error("gone");
		}) as typeof process.kill);
		stopProcessGroup(7, "SIGKILL");
		spy.mockRestore();
	});

	it("does not signal a pid occupying the port after this run", async () => {
		const killed: number[] = [];
		const spy = vi.spyOn(process, "kill").mockImplementation(((pid: number) => {
			killed.push(Number(pid));
			return true;
		}) as typeof process.kill);
		const child = new EventEmitter() as ChildProcess & EventEmitter;
		Object.defineProperty(child, "pid", { value: 4242 });
		Object.defineProperty(child, "exitCode", { writable: true, value: 0 });
		child.stdout = new EventEmitter() as ChildProcess["stdout"];
		child.stderr = new EventEmitter() as ChildProcess["stderr"];
		child.kill = (() => true) as ChildProcess["kill"];
		await runE2eApi({
			bundle: async () => "export default {}",
			prepareDb: async () => undefined,
			assertFree: async () => undefined,
			wait: async () => undefined,
			generateJwks: async () => ({
				kid: "e2e",
				privateJwk: { kty: "RSA" },
				publicJwk: { kty: "RSA", kid: "e2e" },
			}),
			startJwks: async () => ({
				url: "http://127.0.0.1:17057/cdn-cgi/access/certs",
				close: async () => undefined,
			}),
			createRuntime: () => ({
				ready: Promise.resolve(new URL("http://127.0.0.1")),
				dispose: async () => undefined,
			}),
			spawnVitest: async () => undefined,
		});
		expect(killed).toEqual([]);
		spy.mockRestore();
	});

	it("treats signal exit as done and reuses in-flight cleanup", async () => {
		const child = new EventEmitter() as ChildProcess & EventEmitter;
		Object.defineProperty(child, "exitCode", { writable: true, value: null });
		Object.defineProperty(child, "signalCode", { writable: true, value: null });
		const signals: Array<NodeJS.Signals | undefined> = [];
		child.kill = ((signal?: NodeJS.Signals) => {
			signals.push(signal);
			if (signal === "SIGTERM") {
				Object.defineProperty(child, "signalCode", { writable: true, value: "SIGTERM" });
				queueMicrotask(() => child.emit("exit", null, "SIGTERM"));
			}
			return true;
		}) as ChildProcess["kill"];
		const hung = async () => {
			await new Promise(() => undefined);
		};
		const first = stopChild(child, hung);
		const concurrent = stopChild(child, hung);
		await Promise.all([first, concurrent]);
		await stopChild(child, hung);
		expect(signals).toEqual(["SIGTERM"]);
	});

	it("force-kills a child that ignores SIGTERM", async () => {
		const child = new EventEmitter() as ChildProcess & EventEmitter & { exitCode: number | null };
		Object.defineProperty(child, "exitCode", { writable: true, value: null });
		const signals: Array<NodeJS.Signals | undefined> = [];
		child.kill = ((signal?: NodeJS.Signals) => {
			signals.push(signal);
			if (signal === "SIGKILL") {
				Object.defineProperty(child, "exitCode", { writable: true, value: 1 });
				child.emit("exit", 1);
			}
			return true;
		}) as ChildProcess["kill"];
		await stopChild(child, async () => undefined);
		expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
	});

	it("resolves or rejects the vitest child", async () => {
		const ok = { on: (event: string, cb: (code: number) => void) => event === "exit" && cb(0) };
		await spawnVitestProcess(
			{ OCTO_E2E: "http://127.0.0.1" },
			(() => ok) as unknown as typeof import("node:child_process").spawn,
		);
		const bad = { on: (event: string, cb: (code: number) => void) => event === "exit" && cb(2) };
		await expect(
			spawnVitestProcess(
				{ OCTO_E2E: "http://127.0.0.1" },
				(() => bad) as unknown as typeof import("node:child_process").spawn,
			),
		).rejects.toThrow("vitest exited 2");
	});
});
