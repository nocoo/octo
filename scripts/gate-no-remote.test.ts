import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	main,
	remoteViolation,
	runGateNoRemote,
	scanRemote,
	tomlHasRemoteBinding,
	valueHasRemoteTrue,
} from "./gate-no-remote";

describe("gate:no-remote", () => {
	it("detects forbidden tokens built without embedding them here as literals", () => {
		expect(remoteViolation("wrangler d1 execute --local")).toBe(false);
		expect(remoteViolation(`${"--"}remote`)).toBe(true);
		expect(remoteViolation(`remote${" = true"}`)).toBe(true);
		expect(remoteViolation(`remote${": true"}`)).toBe(true);
		expect(remoteViolation(`remote${"=true"}`)).toBe(true);
		expect(remoteViolation(`remote${"  =  true"}`)).toBe(true);
		expect(remoteViolation(`remote${":true"}`)).toBe(true);
		expect(tomlHasRemoteBinding(`[[d1_databases]]\n"remote"${" = true"}\n`)).toBe(true);
		expect(tomlHasRemoteBinding(`[[d1_databases]]\n'remote'${" = true"}\n`)).toBe(true);
		expect(
			tomlHasRemoteBinding(`[env.prod]\n[[env.prod.d1_databases]]\nremote${" = true"}\n`),
		).toBe(true);
		expect(tomlHasRemoteBinding(`[[d1_databases]]\nremote${" = false"}\n`)).toBe(false);
		expect(tomlHasRemoteBinding("name = 'octo'\n")).toBe(false);
		expect(tomlHasRemoteBinding("not toml {")).toBe(true);
		expect(valueHasRemoteTrue("x")).toBe(false);
		expect(valueHasRemoteTrue([{ remote: false }, 1])).toBe(false);
	});

	it("fails a fixture tree that enables remote mode", async () => {
		const root = join(tmpdir(), `octo-remote-${Date.now()}`);
		await mkdir(join(root, "scripts"), { recursive: true });
		await mkdir(join(root, "tests"), { recursive: true });
		await writeFile(join(root, "wrangler.toml"), "name = 'octo'\n");
		await writeFile(join(root, "scripts", "ok.ts"), "export const local = true;\n");
		await writeFile(join(root, "tests", "ok.ts"), "export {}\n");
		try {
			expect(await runGateNoRemote(root)).toBe(0);
			await writeFile(join(root, "wrangler.toml"), `[[d1_databases]]\nremote${"=true"}\n`);
			expect(await runGateNoRemote(root)).toBe(1);
			await writeFile(join(root, "wrangler.toml"), `[[d1_databases]]\n"remote"${" = true"}\n`);
			expect(await runGateNoRemote(root)).toBe(1);
			await writeFile(join(root, "wrangler.toml"), `[[d1_databases]]\n'remote'${" = true"}\n`);
			expect(await runGateNoRemote(root)).toBe(1);
			await writeFile(join(root, "wrangler.toml"), "name = 'octo'\n");
			await writeFile(join(root, "scripts", "bad.ts"), `const flag = "${"--"}remote";\n`);
			expect(await scanRemote([join(root, "scripts", "bad.ts")])).toEqual([
				join(root, "scripts", "bad.ts"),
			]);
			expect(await runGateNoRemote(root)).toBe(1);
			expect(await runGateNoRemote()).toBe(0);
			expect(await main()).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
