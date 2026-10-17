import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, runGateTestSkip, SKIP_PATTERN, scanSkippedTests } from "./gate-test-skip";

describe("gate:test-skip", () => {
	it("detects skip/only tokens", () => {
		expect(SKIP_PATTERN.test(`it.${"skip"}('x', () => {})`)).toBe(true);
		expect(SKIP_PATTERN.test("it('x', () => {})")).toBe(false);
	});

	it("fails on a fixture with skipped tests and passes a clean tree", async () => {
		const root = join(tmpdir(), `octo-skip-${Date.now()}`);
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "bad.ts"), `it.${"skip"}('no', () => {});\n`);
		await writeFile(join(root, "good.ts"), "it('ok', () => {});\n");
		try {
			const hits = await scanSkippedTests([root]);
			expect(hits.some((hit) => hit.includes("bad.ts"))).toBe(true);
			expect(await runGateTestSkip([root])).toBe(1);
			await writeFile(join(root, "bad.ts"), "it('ok', () => {});\n");
			expect(await runGateTestSkip([root])).toBe(0);
			expect(await runGateTestSkip()).toBe(0);
			expect(await main()).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
