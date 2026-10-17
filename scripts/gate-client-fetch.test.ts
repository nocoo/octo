import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkClientSource, main, runGateClientFetch } from "./gate-client-fetch";

describe("client transport boundary", () => {
	it.each([
		"fetch('/api/admin/me')",
		"window.fetch('/api/admin/me')",
		"const request = globalThis['fetch']; request('/api/admin/me')",
		"const {fetch: request} = window; request('/api/admin/me')",
		"new XMLHttpRequest()",
		"import axios from 'axios'",
	])("rejects alternate transport: %s", (source) => {
		expect(checkClientSource("view.ts", source).length).toBeGreaterThan(0);
	});
	it.each([
		"window.fetch('/external')",
		"const request = fetch; request('/external')",
		"globalThis['fetch']('/external')",
	])("rejects indirect transport even in the boundary: %s", (source) => {
		expect(checkClientSource("lib/api.ts", source).length).toBeGreaterThan(0);
	});
	it("requires the sole fetch to use the literal admin prefix", () => {
		expect(checkClientSource("lib/api.ts", `fetch(\`/api/admin\${path}\`, {})`)).toEqual([]);
		expect(checkClientSource("lib/api.ts", "fetch(url)")).toHaveLength(1);
		expect(checkClientSource("lib/api.ts", 'fetch("/api/v1/me")')).toHaveLength(1);
		expect(checkClientSource("view.tsx", "const View = () => <p>fetch</p>")).toEqual([]);
	});
	it("scans production source and reports violations", async () => {
		const root = await mkdtemp(join(tmpdir(), "octo-fetch-"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await mkdir(join(root, "lib"));
			await writeFile(join(root, "lib/api.ts"), `fetch(\`/api/admin\${path}\`)`);
			await writeFile(join(root, "api.test.ts"), "fetch('test')");
			expect(await runGateClientFetch(root)).toBe(0);
			await writeFile(join(root, "bad.ts"), "fetch('/')");
			expect(await main(root)).toBe(1);
			expect(error).toHaveBeenCalled();
			await writeFile(join(root, "bad.ts"), "const ok = 1");
			await writeFile(join(root, "lib/api.ts"), "const empty = 1");
			expect(await runGateClientFetch(root)).toBe(1);
		} finally {
			log.mockRestore();
			error.mockRestore();
			await rm(root, { recursive: true, force: true });
		}
	});
});
