import { describe, expect, it } from "vitest";
import { setup } from "./__tests__/app";

describe("MCP search completeness", () => {
	it.each([
		{ query: "团子", partial: true, partial_reason: "short_term_scan_limit" },
		{ query: "octopus", partial: false, partial_reason: null },
	])("explains completeness for $query", async ({ query, partial, partial_reason }) => {
		const { call, flush } = await setup();
		const result = await call("search", { query, mode: "fts" });
		expect(result.result.isError).not.toBe(true);
		expect(result.result.structuredContent).toMatchObject({
			channels: { fts: { partial, partial_reason } },
		});
		await flush();
	});

	it("publishes the nullable reason enum in the search output schema", async () => {
		const { rpc, flush } = await setup();
		const response = await rpc("tools/list");
		const body = (await response.json()) as {
			result: { tools: Array<{ name: string; outputSchema: unknown }> };
		};
		const schema = JSON.stringify(
			body.result.tools.find((tool) => tool.name === "search")?.outputSchema,
		);
		expect(schema).toContain('"partial_reason"');
		expect(schema).toContain('"short_term_scan_limit"');
		await flush();
	});
});
