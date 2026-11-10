import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCoverageScript, main } from "./gate-coverage-script";

describe("gate:coverage-script", () => {
	it("rejects a missing or fake vitest coverage command", async () => {
		const root = join(tmpdir(), `octo-cov-gate-${Date.now()}`);
		await mkdir(root, { recursive: true });
		const manifest = join(root, "package.json");
		await writeFile(
			manifest,
			`${JSON.stringify({ scripts: { "test:coverage": 'node -e "process.exit(0)"' } }, null, 2)}\n`,
		);
		try {
			expect(await assertCoverageScript(manifest)).toBe(1);
			await writeFile(
				manifest,
				`${JSON.stringify({ scripts: { "test:coverage": "vitest run --coverage" } }, null, 2)}\n`,
			);
			expect(await assertCoverageScript(manifest)).toBe(0);
			expect(await main()).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
