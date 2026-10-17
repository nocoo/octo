import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	assertLocalMode,
	assertPortFree,
	assertWranglerConfigLocal,
	createExclusiveDir,
	listenError,
	listenErrorCode,
	occupyingPid,
	persistDir,
	prepareE2eDb,
	rewriteWranglerConfig,
	runE2eApi,
	spawnVitestProcess,
	stopChild,
	waitLive,
	wranglerDevArgs,
} from "./e2e";

describe("e2e helpers", () => {
	it("forbids remote wrangler and requires local mode", () => {
		expect(() => assertLocalMode(["dev", "--local"])).not.toThrow();
		expect(() => assertLocalMode(["dev"])).toThrow("--local");
		expect(() => assertLocalMode(["dev", "--local", `${"--"}remote`])).toThrow("forbidden");
	});

	it("builds persist paths and rewrites wrangler config", () => {
		expect(persistDir("abc", "/repo")).toBe("/repo/.wrangler/e2e/abc");
		const rewritten = rewriteWranglerConfig(
			[
				"[dev]",
				"port = 37059",
				'directory = "./dist/client"',
				'main = "apps/web/src/server/index.ts"',
				"",
			].join("\n"),
			17059,
			"/tmp/assets",
			"/repo/apps/web/src/server/index.ts",
		);
		expect(rewritten).toContain("port = 17059");
		expect(rewritten).toContain("/tmp/assets");
		expect(wranglerDevArgs(17059, "p", "c", "e").includes("--local")).toBe(true);
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
	it("starts local wrangler, runs vitest, and stops the child", async () => {
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
		const vitest = vi.fn(async () => undefined);
		const code = await runE2eApi({
			prepareDb: async () => undefined,
			assertFree: async () => undefined,
			wait: async () => undefined,
			spawnWrangler: () => {
				queueMicrotask(() => {
					child.stdout?.emit("data", Buffer.from("out"));
					child.stderr?.emit("data", Buffer.from("err"));
				});
				return child;
			},
			spawnVitest: vitest,
		});
		expect(code).toBe(0);
		expect(vitest).toHaveBeenCalled();
		await stopChild(child);
		Object.defineProperty(child, "exitCode", { writable: true, value: 0 });
		await stopChild(child);
		expect(occupyingPid(1)).toBe("unknown");
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
