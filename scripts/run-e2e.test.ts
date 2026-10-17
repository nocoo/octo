import { describe, expect, it, vi } from "vitest";

vi.mock("./e2e", () => ({
	runE2eApi: async () => 0,
}));

import { main } from "./run-e2e";

describe("run-e2e entry", () => {
	it("delegates to runE2eApi", async () => {
		expect(await main()).toBe(0);
	});
});
