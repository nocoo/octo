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
	createD1Exec: () => state.exec,
}));
let fixture: ReturnType<typeof sqliteD1>;
beforeAll(() => {
	fixture = sqliteD1();
	fixture.sqlite.exec(
		"CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO _test_marker VALUES ('env', 'test')",
	);
	fixture.sqlite.exec(
		"INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('unrelated', 'unrelated', 'Unrelated', 0, 0)",
	);
	state.exec = (args) => {
		const sql = args[args.indexOf("--command") + 1];
		if (!sql) throw new Error("expected local SQL command");
		return JSON.stringify([{ results: fixture.sqlite.prepare(sql).all(), success: true }]);
	};
	vi.stubEnv("OCTO_PERSIST", "in-process");
	vi.stubEnv("OCTO_CONFIG", "in-process");
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

await import("../../../../../tests/api/auth-me.test");
