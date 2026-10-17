import { describe, expect, it, vi } from "vitest";
import {
	bunSpawn,
	gitleaksDetectArgs,
	gitleaksRanges,
	main,
	runGateSecurity,
	runNamed,
	type SpawnFn,
	type SpawnResult,
	securityTasks,
} from "./gate-security";

const ok: SpawnResult = { exitCode: 0, stdout: "", stderr: "" };

function mockScanner(selfTest: "pass" | "empty-hit" | "miss" | "clean-hit" | "throw"): SpawnFn {
	return async (cmd) => {
		if (selfTest === "throw") {
			throw new Error("missing");
		}
		if (cmd.includes("--no-git")) {
			const config = cmd.find((part) => part.startsWith("--config=")) ?? "";
			const source = cmd.find((part) => part.startsWith("--source=")) ?? "";
			if (selfTest === "empty-hit") {
				return { exitCode: 1, stdout: "", stderr: "" };
			}
			if (config.includes("empty")) {
				return ok;
			}
			if (selfTest === "miss") {
				return ok;
			}
			if (source.includes("clean")) {
				return selfTest === "clean-hit" ? { exitCode: 1, stdout: "", stderr: "" } : ok;
			}
			return { exitCode: 1, stdout: "", stderr: "" };
		}
		return ok;
	};
}

describe("gate:security", () => {
	it("builds gitleaks and osv tasks from stdin ranges", () => {
		expect(gitleaksRanges("--deps", undefined)).toEqual([]);
		expect(gitleaksRanges(undefined, undefined)).toEqual(["origin/main..HEAD"]);
		expect(gitleaksRanges(undefined, "abc def")).toEqual(["abc", "def"]);
		expect(securityTasks("--deps", [])).toEqual([
			{ cmd: ["osv-scanner", "--lockfile=bun.lock"], label: "osv-scanner" },
		]);
		expect(securityTasks("--secrets", ["HEAD"])).toEqual([
			{
				cmd: [
					"gitleaks",
					"detect",
					"--no-banner",
					"--redact",
					"--config=.gitleaks.toml",
					"--log-opts=HEAD",
				],
				label: "gitleaks HEAD",
			},
		]);
		expect(gitleaksDetectArgs("src", "cfg.toml")).toEqual([
			"gitleaks",
			"detect",
			"--no-banner",
			"--redact",
			"--no-git",
			"--source=src",
			"--config=cfg.toml",
		]);
	});

	it("self-tests gitleaks rules through mocked scanner calls", async () => {
		const spawn = vi.fn(mockScanner("pass"));
		expect(await runGateSecurity(undefined, "HEAD", spawn)).toBe(0);
		expect(spawn.mock.calls.filter((call) => call[0].includes("--no-git"))).toHaveLength(3);
		const deps = vi.fn(mockScanner("pass"));
		expect(await runGateSecurity("--deps", undefined, deps)).toBe(0);
		expect(deps.mock.calls.some((call) => call[0].includes("--no-git"))).toBe(false);
	});

	it("fails G2 when the gitleaks self-test contract is broken", async () => {
		expect(await runGateSecurity(undefined, "HEAD", mockScanner("empty-hit"))).toBe(1);
		expect(await runGateSecurity(undefined, "HEAD", mockScanner("miss"))).toBe(1);
		expect(await runGateSecurity(undefined, "HEAD", mockScanner("clean-hit"))).toBe(1);
		expect(await runGateSecurity(undefined, "HEAD", mockScanner("throw"))).toBe(1);
	});

	it("fails when a tool is missing or exits non-zero", async () => {
		expect(
			await runNamed(["gitleaks"], "gitleaks", async () => {
				throw new Error("missing");
			}),
		).toBe(false);
		expect(
			await runNamed(["gitleaks"], "gitleaks", async () => ({
				exitCode: 1,
				stdout: "out",
				stderr: "err",
			})),
		).toBe(false);
		const spawn = vi.fn(mockScanner("pass"));
		expect(await runGateSecurity(undefined, "origin/main..HEAD", spawn)).toBe(0);
		expect(spawn).toHaveBeenCalled();
		expect(
			await runGateSecurity("--deps", undefined, async () => ({
				exitCode: 2,
				stdout: "",
				stderr: "x",
			})),
		).toBe(1);
		expect(await bunSpawn([])).toMatchObject({ exitCode: 1 });
		const echoed = await bunSpawn(["/bin/echo", "octo"]);
		expect(echoed.exitCode).toBe(0);
		expect(echoed.stdout).toContain("octo");
		expect((await bunSpawn(["/no/such/octo-bin"])).exitCode).toBe(1);
		expect((await bunSpawn(["/bin/sh", "-c", "kill -TERM $$"])).exitCode).toBe(1);
		expect(
			await main("--deps", undefined, async () => ({ exitCode: 0, stdout: "", stderr: "" })),
		).toBe(0);
	});
});
