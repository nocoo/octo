import { describe, expect, it } from "vitest";
import { DEV_VITE_PORT, DEV_WORKER_PORT, L2_WORKER_PORT, L3_WORKER_PORT } from "./ports";

describe("ports", () => {
	it("uses the approved octo lanes", () => {
		expect(DEV_VITE_PORT).toBe(7059);
		expect(DEV_WORKER_PORT).toBe(37059);
		expect(L2_WORKER_PORT).toBe(17059);
		expect(L3_WORKER_PORT).toBe(27059);
	});
});
