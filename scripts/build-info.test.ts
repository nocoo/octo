import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateBuildInfo, main } from "./build-info";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

describe("Worker build identity", () => {
	it.each(["deploy", "versions upload"])(
		"records the checked-out SHA and UTC time for %s",
		async (command) => {
			const root = await mkdtemp(join(tmpdir(), "octo-build-info-"));
			try {
				const sha = "abc1234";
				vi.mocked(execFileSync).mockReturnValue(`${sha}\n`);
				vi.useFakeTimers();
				vi.setSystemTime(new Date("2026-10-18T01:02:03.456Z"));
				expect(await generateBuildInfo(root, command)).toBe(0);
				expect(execFileSync).toHaveBeenCalledWith("git", ["rev-parse", "--short", "HEAD"], {
					cwd: root,
					encoding: "utf8",
				});
				expect(await readFile(join(root, ".wrangler/build-info.ts"), "utf8")).toBe(
					`export const BUILD_INFO = ${JSON.stringify({ git_sha: sha, build_time: "2026-10-18T01:02:03.456Z" })};\n`,
				);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it.each([undefined, "dev", "types"])("uses unknown without git for %s", async (command) => {
		const root = await mkdtemp(join(tmpdir(), "octo-build-info-"));
		try {
			expect(await generateBuildInfo(root, command)).toBe(0);
			expect(execFileSync).not.toHaveBeenCalled();
			expect(await readFile(join(root, ".wrangler/build-info.ts"), "utf8")).toBe(
				'export const BUILD_INFO = {"git_sha":"unknown","build_time":"unknown"};\n',
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails a production build without a git checkout", async () => {
		const root = await mkdtemp(join(tmpdir(), "octo-build-info-"));
		try {
			vi.mocked(execFileSync).mockImplementation(() => {
				throw new Error("not a git checkout");
			});
			await expect(generateBuildInfo(root, "deploy")).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("wires Wrangler's build hook and alias into the production CI packaging path", async () => {
		const config = parse(await readFile("wrangler.toml", "utf8"));
		expect(config.main).toBe("apps/web/src/server/index.ts");
		expect(config.build).toMatchObject({ command: "bun run scripts/build-info.ts" });
		expect(config.alias).toEqual({ "../../lib/build-info": "./.wrangler/build-info.ts" });
		const workflow = await readFile(".github/workflows/ci.yml", "utf8");
		expect(workflow).toContain("build: true");
		expect(workflow).toContain(
			"bun run build && ./node_modules/.bin/wrangler deploy --dry-run --outdir dist/worker",
		);
	});

	it("runs the CLI with development defaults", async () => {
		vi.stubEnv("WRANGLER_COMMAND", "dev");
		expect(await main()).toBe(0);
	});
});
