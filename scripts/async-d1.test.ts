import { describe, expect, it, vi } from "vitest";
import { assertAsyncTestMarker } from "./local-d1";

describe("async fixture ownership checks", () => {
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
});
