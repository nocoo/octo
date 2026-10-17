import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";
import type { Env } from "../env";
import { worker } from "../index";

const state = vi.hoisted(() => ({
	exec: (_args: string[]): string => {
		throw new Error("fixture not initialized");
	},
	opened: [] as string[][],
	commands: [] as string[][],
}));
vi.mock("../../../../../scripts/local-d1", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../../../scripts/local-d1")>()),
	createD1Exec: () => {
		throw new Error("M2 HTTP fixtures must use the awaited cached SDK executor");
	},
}));
vi.mock("../../../../../scripts/fixture-d1", () => ({
	openFixtureD1: async (...args: string[]) => {
		state.opened.push(args);
		await new Promise<void>((resolve) => setImmediate(resolve));
		return {
			exec: async (args: string[]) => {
				await new Promise<void>((resolve) => setImmediate(resolve));
				return state.exec(args);
			},
			dispose: async () => {},
		};
	},
}));
let fixture: ReturnType<typeof sqliteD1>;
beforeAll(() => {
	fixture = sqliteD1();
	fixture.sqlite.exec(
		"CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO _test_marker VALUES ('env', 'test')",
	);
	state.exec = (args) => {
		state.commands.push(args);
		const sql = args[args.indexOf("--command") + 1];
		if (!sql) throw new Error("expected isolated SQL command");
		const results = args.includes("--json") ? fixture.sqlite.prepare(sql).all() : [];
		if (!args.includes("--json")) fixture.sqlite.exec(sql);
		return JSON.stringify([{ results, success: true }]);
	};
	vi.stubEnv("OCTO_PERSIST", "in-process-m2");
	vi.stubEnv("OCTO_CONFIG", "in-process-m2.toml");
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

await import("../../../../../tests/api/memories.test");
await import("../../../../../tests/api/memories-matrix.test");
await import("../../../../../tests/api/changes.test");

it("shares one awaited SDK session across every guarded M2 fixture setup", () => {
	expect(state.opened).toEqual([["in-process-m2", "in-process-m2.toml"]]);
	const markerChecks = state.commands.filter(
		(args) => args[1] === "SELECT value FROM _test_marker WHERE key = 'env'",
	);
	expect(markerChecks).toHaveLength(8);
});
