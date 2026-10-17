import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../tests/fixtures/sqlite-d1";
import fixture from "../../../../tests/fixtures/worker";
import type { Env } from "./env";
import { worker } from "./index";

afterEach(() => vi.restoreAllMocks());

function setup() {
	const { db, sqlite } = sqliteD1();
	sqlite.exec(
		"CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT); INSERT INTO _test_marker VALUES ('env', 'test')",
	);
	return {
		env: { DB: db, RESOURCE_ENV: "test" } as Env,
		context: { waitUntil: vi.fn() } as unknown as ExecutionContext,
	};
}

describe("isolated HTTP fixture background barrier", () => {
	it("keeps early responses and explicitly drains registered background work", async () => {
		const { env, context } = setup();
		const pending = Promise.withResolvers<void>();
		vi.spyOn(worker, "fetch").mockImplementation((_request, _env, execution) => {
			execution.waitUntil(pending.promise);
			return new Response("early");
		});
		const response = await fixture.fetch(new Request("http://local/api/live"), env, context);
		expect(await response.text()).toBe("early");
		pending.resolve();
		const flushed = await fixture.fetch(
			new Request("http://local/api/__test/background", { method: "POST" }),
			env,
			context,
		);
		expect(await flushed.json()).toEqual({ drained: true });
		expect(worker.fetch).toHaveBeenCalledTimes(1);
	});

	it("runs the production scheduled handler and waits for its work", async () => {
		const { env, context } = setup();
		const scheduled = vi
			.spyOn(worker, "scheduled")
			.mockImplementation((_event, _env, execution) => {
				execution.waitUntil(Promise.resolve());
			});
		const response = await fixture.fetch(
			new Request("http://local/api/__test/cron", { method: "POST" }),
			env,
			context,
		);
		expect(await response.json()).toEqual({ drained: true });
		expect(scheduled).toHaveBeenCalledOnce();
	});

	it("does not expose barriers outside the marked local fixture", async () => {
		const { env, context } = setup();
		await expect(
			fixture.fetch(
				new Request("http://local/api/__test/background", { method: "POST" }),
				{ ...env, RESOURCE_ENV: "production" },
				context,
			),
		).rejects.toThrow("local test marker");
	});
});
