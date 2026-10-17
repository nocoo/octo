import { describe, expect, it, vi } from "vitest";
import { runDev, viteArgs, wranglerSidecarArgs } from "./dev";

describe("dev", () => {
	it("uses the sidecar and vite ports", () => {
		expect(wranglerSidecarArgs()).toEqual(["dev", "--local", "--port", "37059"]);
		expect(viteArgs()).toEqual(["--port", "7059", "--strictPort"]);
	});

	it("stops both processes when one exits", async () => {
		const killed: string[] = [];
		const spawn = (cmd: string[]) => {
			const name = String(cmd[0]);
			return {
				exited: name.includes("vite") ? Promise.resolve(0) : new Promise<number>(() => undefined),
				kill: () => {
					killed.push(name);
				},
			};
		};
		const prepare = vi.fn();
		expect(await runDev("/tmp", spawn, prepare)).toBe(0);
		expect(prepare).toHaveBeenCalledWith("/tmp");
		expect(killed.length).toBe(2);
	});

	it("returns 1 when the exit code is missing", async () => {
		const spawn = () => ({
			exited: Promise.resolve(undefined as unknown as number),
			kill: () => undefined,
		});
		expect(await runDev("/tmp", spawn, () => undefined)).toBe(1);
	});
});
