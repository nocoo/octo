import { describe, expect, it, vi } from "vitest";

const { runE2eApi } = vi.hoisted(() => ({
	runE2eApi: vi.fn(async () => 0),
}));

vi.mock("./e2e", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./e2e")>();
	return {
		...actual,
		runE2eApi,
	};
});

import { main } from "./run-e2e";

describe("run-e2e entry", () => {
	it("delegates to runE2eApi without shard by default", async () => {
		runE2eApi.mockClear();
		expect(await main([])).toBe(0);
		expect(runE2eApi).toHaveBeenCalledWith({});
	});

	it("forwards parsed --shard to runE2eApi", async () => {
		runE2eApi.mockClear();
		expect(await main(["--shard=1/2"])).toBe(0);
		expect(runE2eApi).toHaveBeenCalledWith({
			shard: { raw: "1/2", index: 1, total: 2 },
		});
	});
});
