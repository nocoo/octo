import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/api/**/*.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		sequence: { shuffle: false },
		hookTimeout: 180_000,
		testTimeout: 120_000,
	},
});
