import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectTsFiles } from "./fs-walk";

describe("collectTsFiles", () => {
	it("walks nested ts files and ignores missing roots", async () => {
		const root = join(tmpdir(), `octo-walk-${Date.now()}`);
		await mkdir(join(root, "nested"), { recursive: true });
		await writeFile(join(root, "a.ts"), "export {}\n");
		await writeFile(join(root, "nested", "b.tsx"), "export {}\n");
		await writeFile(join(root, "c.txt"), "no\n");
		try {
			const files = await collectTsFiles(root);
			expect(files.sort()).toEqual([join(root, "a.ts"), join(root, "nested", "b.tsx")].sort());
			expect(await collectTsFiles(join(root, "missing"))).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
