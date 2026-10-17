import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	bunSpawn,
	gitleaksDetectArgs,
	gitleaksRanges,
	main,
	runGateSecurity,
	runNamed,
	securityTasks,
} from "./gate-security";

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
	});

	it("detects a synthetic slack token with default rules and misses it with an empty config", async () => {
		const slack = ["xoxb", "123456789012", "123456789012", "abcdefghijklmnopqrstuvwx"].join("-");
		const dirty = join(tmpdir(), `octo-gitleaks-${Date.now()}`);
		const clean = join(tmpdir(), `octo-gitleaks-clean-${Date.now()}`);
		await mkdir(dirty);
		await mkdir(clean);
		await writeFile(join(dirty, "leak.txt"), `token = ${slack}\n`);
		await writeFile(join(clean, "ok.txt"), "hello\n");
		const emptyCfg = join(dirty, "empty.toml");
		await writeFile(emptyCfg, 'title = "fixture"\n');
		const repoCfg = join(process.cwd(), ".gitleaks.toml");
		try {
			expect((await bunSpawn(gitleaksDetectArgs(dirty, emptyCfg))).exitCode).toBe(0);
			expect((await bunSpawn(gitleaksDetectArgs(dirty, repoCfg))).exitCode).toBe(1);
			expect((await bunSpawn(gitleaksDetectArgs(clean, repoCfg))).exitCode).toBe(0);
		} finally {
			await rm(dirty, { recursive: true, force: true });
			await rm(clean, { recursive: true, force: true });
		}
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
		const spawn = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
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
