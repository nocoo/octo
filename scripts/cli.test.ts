import { describe, expect, it, vi } from "vitest";
import { defaultExit, runIfMain } from "./cli";

describe("runIfMain", () => {
	it("skips when not main and exits with the run code when main", async () => {
		const exit = vi.fn();
		await runIfMain({ main: false }, async () => 2, exit);
		expect(exit).not.toHaveBeenCalled();
		await runIfMain({ main: true }, async () => 0, exit);
		expect(exit).toHaveBeenCalledWith(0);
		const spy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		defaultExit(3);
		expect(spy).toHaveBeenCalledWith(3);
		await runIfMain({ main: true }, async () => 4);
		expect(spy).toHaveBeenCalledWith(4);
		spy.mockRestore();
	});
});
