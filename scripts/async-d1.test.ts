import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertAsyncTestMarker, createAsyncD1Exec } from "./local-d1";

async function withExecutable(source: string, run: (bin: string, cwd: string) => Promise<void>) {
	const cwd = await mkdtemp(join(tmpdir(), "octo-async-d1-"));
	const bin = join(cwd, "fake-wrangler");
	await writeFile(bin, `#!${process.execPath}\n${source}`, { mode: 0o700 });
	try {
		await run(bin, cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

describe("async local D1 executor", () => {
	it("awaits the marker before permitting fixture writes", async () => {
		const order: string[] = [];
		const d1 = vi.fn(async (args: string[]) => {
			order.push(args[1] ?? "");
			await new Promise<void>((resolve) => setImmediate(resolve));
			return '[{"results":[{"value":"test"}]}]';
		});
		await assertAsyncTestMarker(d1);
		await d1(["--command", "INSERT fixture"]);
		expect(order).toEqual(["SELECT value FROM _test_marker WHERE key = 'env'", "INSERT fixture"]);
	});
	it.each([
		"noise",
		"[]",
		"[{}]",
		'[{"results":[]}]',
		'[{"results":[{}]}]',
		'[{"results":[{"value":"production"}]}]',
	])("rejects non-test ownership %s before writes", async (stdout) => {
		const d1 = vi.fn(async () => stdout);
		await expect(
			(async () => {
				await assertAsyncTestMarker(d1);
				await d1();
			})(),
		).rejects.toThrow("_test_marker env=test");
		expect(d1).toHaveBeenCalledTimes(1);
	});
	it("propagates CLI failures without retrying", async () => {
		await withExecutable(
			"process.stderr.write('injected failure'); process.exit(7);",
			async (bin, cwd) => {
				await expect(
					createAsyncD1Exec(bin, cwd, "isolated", "config.toml")(["--json"]),
				).rejects.toMatchObject({ code: 7 });
			},
		);
	});
	it("keeps the client event loop serviceable while waiting for the CLI", async () => {
		await withExecutable(
			"setTimeout(() => process.stdout.write(JSON.stringify(process.argv.slice(2))), 150);",
			async (bin, cwd) => {
				const d1 = createAsyncD1Exec(bin, cwd, "isolated", "config.toml");
				let ticks = 0;
				const timer = setInterval(() => {
					ticks++;
				}, 5);
				try {
					const stdout = await d1(["--command", "SELECT 'literal ; $value'", "--json"]);
					expect(ticks).toBeGreaterThan(0);
					expect(JSON.parse(stdout)).toEqual([
						"d1",
						"execute",
						"octo-db",
						"--local",
						"--persist-to=isolated",
						"--config=config.toml",
						"--command",
						"SELECT 'literal ; $value'",
						"--json",
					]);
				} finally {
					clearInterval(timer);
				}
			},
		);
	});
});
