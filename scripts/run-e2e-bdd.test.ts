import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as e2e from "./e2e";
import * as jwks from "./jwks-stub";
import { bddPaths, main, type RunBddOptions, runCommand, runE2eBdd } from "./run-e2e-bdd";

vi.mock("node:child_process", async (original) => ({
	...(await original<typeof import("node:child_process")>()),
	spawn: vi.fn(),
}));

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
	vi.restoreAllMocks();
});

function child(): ChildProcess {
	const process = new EventEmitter() as ChildProcess;
	Object.defineProperty(process, "pid", { value: 0, configurable: true });
	Object.defineProperty(process, "exitCode", { value: null, writable: true });
	process.stdout = new EventEmitter() as ChildProcess["stdout"];
	process.stderr = new EventEmitter() as ChildProcess["stderr"];
	process.kill = vi.fn(() => {
		Object.defineProperty(process, "exitCode", { value: 0 });
		process.emit("exit", 0);
		return true;
	});
	return process;
}

async function options(): Promise<RunBddOptions> {
	const root = await mkdtemp(join(tmpdir(), "octo-l3-runner-"));
	directories.push(root);
	await writeFile(
		join(root, "wrangler.toml"),
		`name = "octo"
main = "apps/web/src/server/index.ts"
compatibility_date = "2026-04-01"
[dev]
port = 37059
[assets]
directory = "./dist/client"
binding = "ASSETS"
[[routes]]
pattern = "octo.hexly.ai"
custom_domain = true
[[d1_databases]]
binding = "DB"
database_name = "octo-db"
database_id = "11111111-1111-1111-1111-111111111111"
[[vectorize]]
binding = "VEC"
index_name = "octo-vec-te3-small-1536"
remote = false
`,
	);
	return {
		root,
		runId: "unit-run",
		command: vi.fn(async () => undefined),
		assertFree: vi.fn(async () => undefined),
		prepareDb: vi.fn(async () => undefined),
		generateJwks: vi.fn(async () => ({ kid: "test", privateJwk: {}, publicJwk: {} })),
		startJwks: vi.fn(async () => ({
			url: "http://127.0.0.1:49152/cdn-cgi/access/certs",
			close: vi.fn(async () => undefined),
		})),
		startWorker: vi.fn(() => child()),
		wait: vi.fn(async () => undefined),
	};
}

describe("L3 runner", () => {
	it("requires an isolated, unambiguous run ID", () => {
		expect(bddPaths("safe-123", "/repo")).toEqual({
			persist: "/repo/.wrangler/e2e-pw/safe-123",
			run: "/repo/.wrangler/e2e-pw-run/safe-123",
			artifacts: "/repo/test-results/l3/safe-123",
		});
		for (const id of ["", "..", "../dev", "a/b", "a\\b", "/tmp", "with space"]) {
			expect(() => bddPaths(id, "/repo")).toThrow("run ID");
		}
	});

	it("builds real assets, checks local config, marks D1, and starts only local Worker", async () => {
		const deps = await options();
		const order: string[] = [];
		const worker = child();
		deps.prepareDb = vi.fn(async () => {
			order.push("marker+migrations");
		});
		deps.startWorker = vi.fn((args, env) => {
			order.push("worker");
			const paths = bddPaths("unit-run", deps.root);
			expect(args).toEqual([
				"dev",
				"--local",
				"--ip",
				"127.0.0.1",
				"--port",
				"27059",
				`--persist-to=${paths.persist}`,
				`--config=${join(paths.run, "wrangler.toml")}`,
				`--env-file=${join(paths.run, ".env")}`,
			]);
			expect(env.WRANGLER_DISABLE_REQUEST_BODY_DRAINING).toBe("true");
			queueMicrotask(() => {
				worker.stdout?.emit("data", Buffer.from(""));
				worker.stderr?.emit("data", Buffer.from(""));
			});
			return worker;
		});
		deps.wait = vi.fn(async (base) => {
			expect(base).toBe("http://127.0.0.1:27059");
			order.push("ready");
		});
		expect(await runE2eBdd(deps)).toBe(0);
		expect(order).toEqual(["marker+migrations", "worker", "ready"]);
		const paths = bddPaths("unit-run", deps.root);
		const config = parse(await readFile(join(paths.run, "wrangler.toml"), "utf8"));
		expect(config.main).toBe(join(deps.root ?? "", "apps/web/src/server/index.ts"));
		expect(config.assets).toMatchObject({ directory: join(paths.run, "client") });
		expect(config.vectorize).toBeUndefined();
		expect(config.routes).toBeUndefined();
		expect(await readFile(join(paths.run, ".env"), "utf8")).toContain("RESOURCE_ENV=test");
		expect(await readFile(join(paths.run, ".env"), "utf8")).toContain(
			"ACCESS_JWKS_URL=http://127.0.0.1:49152/cdn-cgi/access/certs",
		);
		expect(deps.assertFree).toHaveBeenCalledWith(27059);
		expect(deps.assertFree).toHaveBeenCalledTimes(1);
		expect(deps.startJwks).toHaveBeenCalledWith(0, expect.anything());
		expect(deps.command).toHaveBeenNthCalledWith(
			1,
			"vite",
			["build", "--outDir", join(paths.run, "client")],
			{},
			deps.root,
		);
		expect(deps.command).toHaveBeenNthCalledWith(
			2,
			"playwright",
			["test", "--config", "playwright.config.ts"],
			expect.objectContaining({
				OCTO_E2E: "http://127.0.0.1:27059",
				OCTO_PERSIST: paths.persist,
				OCTO_L3_ARTIFACTS: paths.artifacts,
				OCTO_JWKS_PORT: "49152",
			}),
			deps.root,
		);
		expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
		const stub = await vi.mocked(deps.startJwks as NonNullable<RunBddOptions["startJwks"]>).mock
			.results[0]?.value;
		expect(stub?.close).toHaveBeenCalledOnce();
		expect(JSON.parse(await readFile(join(paths.artifacts, "run.json"), "utf8"))).toMatchObject({
			base: "http://127.0.0.1:27059",
			persist: paths.persist,
		});
	});

	it("cleans its Worker and JWKS when readiness or Chromium fails", async () => {
		for (const phase of ["wait", "test", "spawn"] as const) {
			const deps = await options();
			const worker = child();
			const close = vi.fn(async () => undefined);
			deps.startJwks = async () => ({ url: "http://127.0.0.1:49152/cdn-cgi/access/certs", close });
			deps.startWorker = () => {
				if (phase === "spawn") throw new Error("spawn failed");
				return worker;
			};
			deps.wait = async () => {
				if (phase === "wait") throw new Error("wait failed");
			};
			deps.command = async (bin) => {
				if (bin === "playwright" && phase === "test") throw new Error("test failed");
			};
			await expect(runE2eBdd(deps)).rejects.toThrow(`${phase} failed`);
			expect(close).toHaveBeenCalledOnce();
			expect(worker.kill).toHaveBeenCalledTimes(phase === "spawn" ? 0 : 1);
		}
	});

	it("rejects unsafe root config, a reused run, or an occupied port before starting", async () => {
		const unsafe = await options();
		await writeFile(
			join(unsafe.root ?? "", "wrangler.toml"),
			`[[d1_databases]]\nremote${" = true"}\n`,
		);
		await expect(runE2eBdd(unsafe)).rejects.toThrow("remote bindings");
		expect(unsafe.command).not.toHaveBeenCalled();
		const reused = await options();
		await runE2eBdd(reused);
		await expect(runE2eBdd(reused)).rejects.toThrow("already exists");
		const busy = await options();
		busy.assertFree = async () => {
			throw new Error("occupied");
		};
		await expect(runE2eBdd(busy)).rejects.toThrow("occupied");
		expect(busy.startWorker).not.toHaveBeenCalled();
	});

	it("runs binaries without a shell and propagates exit, signal, and startup failures", async () => {
		for (const outcome of [0, 2, null, "error"] as const) {
			const spawn = vi.fn(() => {
				const process = child();
				queueMicrotask(() =>
					outcome === "error"
						? process.emit("error", new Error("spawn failed"))
						: process.emit("exit", outcome),
				);
				return process;
			});
			const result = runCommand(
				"playwright",
				["test"],
				{ OCTO_E2E: "local" },
				"/repo",
				spawn as never,
			);
			if (outcome === 0) await expect(result).resolves.toBeUndefined();
			else
				await expect(result).rejects.toThrow(
					outcome === "error" ? "spawn failed" : `playwright exited ${outcome}`,
				);
			expect(spawn).toHaveBeenCalledWith(
				"/repo/node_modules/.bin/playwright",
				["test"],
				expect.objectContaining({
					cwd: "/repo",
					stdio: "inherit",
					env: expect.objectContaining({ OCTO_E2E: "local" }),
				}),
			);
		}
	});

	it("main delegates with no alternate endpoint or process options", async () => {
		const run = vi.fn(async () => 0);
		expect(await main(run)).toBe(0);
		expect(run).toHaveBeenCalledWith();
	});

	it("does not launch Chromium after interruption or a Worker startup error", async () => {
		for (const phase of ["signal", "error"] as const) {
			const deps = await options();
			const worker = child();
			deps.startWorker = () => worker;
			deps.wait = async () => {
				if (phase === "signal") process.emit("SIGINT");
				else {
					expect(worker.listenerCount("error")).toBe(1);
					worker.emit("error", new Error("worker spawn failed"));
					await new Promise(() => undefined);
				}
			};
			await expect(runE2eBdd(deps)).rejects.toThrow(
				phase === "signal" ? "interrupted" : "worker spawn failed",
			);
			expect(deps.command).toHaveBeenCalledTimes(1);
		}
	});

	it("does not wait for an exit event when Worker spawn never obtained a PID", async () => {
		const deps = await options();
		const worker = child();
		Object.defineProperty(worker, "pid", { value: undefined });
		deps.startWorker = () => worker;
		deps.wait = async () => {
			worker.emit("error", new Error("worker executable missing"));
			await new Promise(() => undefined);
		};
		await expect(runE2eBdd(deps)).rejects.toThrow("worker executable missing");
		expect(worker.kill).not.toHaveBeenCalled();
	});

	it("wires defaults and cleans signal handlers without starting external resources", async () => {
		vi.spyOn(e2e, "prepareE2eDb").mockImplementation(async (persist, config) => {
			directories.push(persist, join(config, ".."));
		});
		vi.spyOn(e2e, "assertPortFree").mockResolvedValue();
		vi.spyOn(e2e, "waitLive").mockResolvedValue();
		vi.spyOn(jwks, "generateJwksPair").mockResolvedValue({
			kid: "test",
			privateJwk: {},
			publicJwk: {},
		});
		const close = vi.fn(async () => undefined);
		vi.spyOn(jwks, "startJwksStub").mockResolvedValue({
			url: "http://127.0.0.1:49152/cdn-cgi/access/certs",
			close,
		});
		vi.mocked(spawn).mockImplementation(((_bin, _args, options) => {
			const process = child();
			const env = options?.env;
			if (env?.OCTO_L3_ARTIFACTS) directories.push(env.OCTO_L3_ARTIFACTS);
			if (!options?.detached) queueMicrotask(() => process.emit("exit", 0));
			return process;
		}) as typeof spawn);
		const before = process.listenerCount("SIGTERM");
		expect(await main()).toBe(0);
		expect(bddPaths("default").persist).toBe(join(e2e.root, ".wrangler/e2e-pw/default"));
		expect(close).toHaveBeenCalledOnce();
		expect(process.listenerCount("SIGTERM")).toBe(before);
	});

	it("refuses a JWKS stub that does not report an allocated local HTTP port", async () => {
		for (const url of [
			"http://127.0.0.1:0/cdn-cgi/access/certs",
			"https://127.0.0.1:49152",
			"http://example.com:49152",
			"http://127.0.0.1",
		]) {
			const deps = await options();
			const close = vi.fn(async () => undefined);
			deps.startJwks = async () => ({ url, close });
			await expect(runE2eBdd(deps)).rejects.toThrow("allocated local JWKS port");
			expect(close).toHaveBeenCalledOnce();
			expect(deps.startWorker).not.toHaveBeenCalled();
		}
	});
});
