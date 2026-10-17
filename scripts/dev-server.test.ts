import { describe, expect, it, vi } from "vitest";
import { runDevServer } from "./dev-server";

describe("dev-server", () => {
	it("spawns wrangler after prepare", async () => {
		const prepare = vi.fn();
		const spawn = vi.fn(() => ({ exited: Promise.resolve(0) }));
		expect(await runDevServer("/tmp", spawn, prepare, 37059)).toBe(0);
		expect(prepare).toHaveBeenCalledWith("/tmp");
		expect(spawn).toHaveBeenCalled();
	});
});
