import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

class E2ESequencer extends BaseSequencer {
	override async sort(files: TestSpecification[]) {
		const sorted = await super.sort(files);
		return sorted.sort((a, b) => {
			const aFirst = a.moduleId.endsWith("/search-ranking.test.ts") ? 0 : 1;
			const bFirst = b.moduleId.endsWith("/search-ranking.test.ts") ? 0 : 1;
			return aFirst - bFirst;
		});
	}
}

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/api/**/*.test.ts"],
		exclude: ["tests/api/author-profile-runtime.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		isolate: false,
		sequence: { shuffle: false, sequencer: E2ESequencer },
		server: { deps: { inline: ["wrangler"] } },
		hookTimeout: 180_000,
		testTimeout: 120_000,
	},
});
