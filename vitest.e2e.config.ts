import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/api/**/*.test.ts"],
		exclude: ["tests/api/author-profile-runtime.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		sequence: { shuffle: false },
		server: { deps: { inline: ["wrangler"] } },
		hookTimeout: 180_000,
		testTimeout: 120_000,
	},
});
