import { afterEach, expect, it, vi } from "vitest";
import { EmbeddingFailure, reportEmbeddingFailure } from "./diagnostics";

afterEach(() => vi.restoreAllMocks());

it.each([
	[null, null],
	["not a URL private-key", null],
	[
		"https://private-user:private-key@gateway.example:8443/private-path?key=private-value",
		"gateway.example:8443",
	],
])("logs only the parsed host for configuration failures", (baseUrl, host) => {
	const logger = vi.spyOn(console, "error").mockImplementation(() => {});
	expect(
		reportEmbeddingFailure("embedding_test_failed", new Error("private-key"), baseUrl),
	).toEqual({ stage: "config" });
	expect(logger.mock.calls).toEqual([[{ event: "embedding_test_failed", stage: "config", host }]]);
	expect(JSON.stringify(logger.mock.calls)).not.toContain("private");
});

it("emits only safe failure metadata rather than the exception object", () => {
	const logger = vi.spyOn(console, "error").mockImplementation(() => {});
	const failure = new EmbeddingFailure(
		{ stage: "status", upstream_status: 401 },
		"private-upstream-body",
	);
	expect(
		reportEmbeddingFailure("embedding_query_failed", failure, "https://gateway.example"),
	).toEqual({ stage: "status", upstream_status: 401 });
	expect(logger.mock.calls).toEqual([
		[
			{
				event: "embedding_query_failed",
				stage: "status",
				upstream_status: 401,
				host: "gateway.example",
			},
		],
	]);
});
