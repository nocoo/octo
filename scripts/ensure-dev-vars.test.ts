import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureClientAssets, ensureDevVars } from "./ensure-dev-vars";

async function withDir(run: (root: string) => Promise<void>): Promise<void> {
	const root = join(tmpdir(), `octo-dev-vars-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(root, { recursive: true });
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("ensureDevVars", () => {
	it("ships a local-only example with a valid AES-256 key encoding", async () => {
		const example = await readFile("dev.vars.example", "utf8");
		const key = example.match(/^OCTO_SETTINGS_KEY=(.+)$/m)?.[1] ?? "";
		expect(Buffer.from(key, "base64").length).toBe(32);
	});

	it("copies local bypass defaults without replacing existing configuration", async () => {
		const example = await readFile("dev.vars.example", "utf8");
		expect(example).toContain("ACCESS_DEV_BYPASS_EMAIL=dev@local\n");
		expect(example).toContain("RESOURCE_ENV=development\n");
		await withDir(async (root) => {
			await writeFile(join(root, "dev.vars.example"), example);
			ensureDevVars(root);
			expect(await readFile(join(root, ".dev.vars"), "utf8")).toBe(example);
			await writeFile(join(root, ".dev.vars"), "ACCESS_DEV_BYPASS_EMAIL=\nRESOURCE_ENV=test\n");
			ensureDevVars(root);
			expect(await readFile(join(root, ".dev.vars"), "utf8")).toBe(
				"ACCESS_DEV_BYPASS_EMAIL=\nRESOURCE_ENV=test\n",
			);
		});
	});
	it("copies the example when missing", async () => {
		await withDir(async (root) => {
			await writeFile(join(root, "dev.vars.example"), "API_KEY_PEPPER=x");
			ensureDevVars(root);
			expect(await readFile(join(root, ".dev.vars"), "utf8")).toBe("API_KEY_PEPPER=x\n");
			ensureDevVars(root);
			expect(await readFile(join(root, ".dev.vars"), "utf8")).toBe("API_KEY_PEPPER=x\n");
		});
	});

	it("keeps an example that already ends with a newline", async () => {
		await withDir(async (root) => {
			await writeFile(join(root, "dev.vars.example"), "API_KEY_PEPPER=x\n");
			ensureDevVars(root);
			expect(await readFile(join(root, ".dev.vars"), "utf8")).toBe("API_KEY_PEPPER=x\n");
		});
	});

	it("restores leftover typecheck files and requires the example", async () => {
		await withDir(async (root) => {
			await writeFile(join(root, ".dev.vars.__typecheck"), "KEPT=1\n");
			ensureDevVars(root);
			expect(await readFile(join(root, ".dev.vars"), "utf8")).toBe("KEPT=1\n");
		});
		await withDir(async (root) => {
			expect(() => ensureDevVars(root)).toThrow("dev.vars.example is required");
		});
	});
});

describe("ensureClientAssets", () => {
	it("writes a placeholder index.html once", async () => {
		await withDir(async (root) => {
			const file = ensureClientAssets(root);
			expect(await readFile(file, "utf8")).toContain("<title>octo</title>");
			await writeFile(file, "kept\n");
			ensureClientAssets(root);
			expect(await readFile(file, "utf8")).toBe("kept\n");
		});
	});
});
