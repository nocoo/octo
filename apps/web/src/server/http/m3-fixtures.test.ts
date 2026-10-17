import { afterAll, beforeAll, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import { worker } from "../index";

const state = vi.hoisted(() => ({
	exec: (_args: string[]): string => {
		throw new Error("fixture not initialized");
	},
}));
vi.mock("../../../../../scripts/local-d1", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../../../scripts/local-d1")>()),
	createD1Exec: () => {
		throw new Error("M3 HTTP fixtures must use the awaited async executor");
	},
	createAsyncD1Exec: () => async (args: string[]) => {
		await new Promise<void>((resolve) => setImmediate(resolve));
		return state.exec(args);
	},
}));
let fixture: ReturnType<typeof sqliteD1>;
beforeAll(() => {
	fixture = sqliteD1();
	fixture.sqlite.exec(
		"CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO _test_marker VALUES ('env', 'test')",
	);
	fixture.sqlite.exec(
		"INSERT INTO changes (entity, entity_id, op, actor, at) VALUES ('memory', 'unrelated-prior-merge', 'tag_merged', 'key:unrelated', 1)",
	);
	state.exec = (args) => {
		const sql = args[args.indexOf("--command") + 1];
		if (!sql) throw new Error("expected isolated SQL command");
		const results = args.includes("--json") ? fixture.sqlite.prepare(sql).all() : [];
		if (!args.includes("--json")) fixture.sqlite.exec(sql);
		return JSON.stringify([{ results, success: true }]);
	};
	vi.stubEnv("OCTO_PERSIST", "in-process-m3");
	vi.stubEnv("OCTO_CONFIG", "in-process-m3");
	vi.stubGlobal("fetch", (input: string | Request, init?: RequestInit) =>
		worker.fetch(
			new Request(input, init),
			{ DB: fixture.db, API_KEY_PEPPER: "change-me-api-key-pepper" } as Env,
			{ waitUntil: () => {} } as unknown as ExecutionContext,
		),
	);
});
afterAll(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	fixture.sqlite.close();
});

await import("../../../../../tests/api/tags.test");
await import("../../../../../tests/api/spaces.test");
await import("../../../../../tests/api/tags-idempotency.test");
