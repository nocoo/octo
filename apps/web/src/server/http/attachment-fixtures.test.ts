import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../../../../tests/fixtures/sqlite-d1";

const state = vi.hoisted(() => ({
	exec: vi.fn<(args: string[]) => Promise<string>>(),
	create: vi.fn(),
}));
vi.mock("../../../../../scripts/local-d1", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../../../scripts/local-d1")>()),
	createD1Exec: () => {
		throw new Error("attachment fixtures must remain asynchronous");
	},
	createAsyncD1Exec: (...args: string[]) => {
		state.create(...args);
		return state.exec;
	},
}));
let f: ReturnType<typeof sqliteD1>;
let fixtures: typeof import("../../../../../tests/fixtures/attachments");
beforeEach(async () => {
	vi.resetModules();
	state.create.mockClear();
	state.exec.mockReset();
	vi.stubEnv("OCTO_PERSIST", "attachment-owned-run");
	vi.stubEnv("OCTO_CONFIG", "attachment-owned.toml");
	f = sqliteD1();
	f.sqlite.exec(
		"CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO _test_marker VALUES ('env', 'test'); INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('unrelated', 'unrelated', 'unrelated', 1, 1)",
	);
	state.exec.mockImplementation(async (args) => {
		const sql = args[args.indexOf("--command") + 1];
		if (!sql) throw new Error("fixture SQL required");
		if (args.includes("--json")) return JSON.stringify([{ results: f.sqlite.prepare(sql).all() }]);
		f.sqlite.exec(sql);
		return "";
	});
	fixtures = await import("../../../../../tests/fixtures/attachments");
});
afterEach(() => {
	vi.unstubAllEnvs();
	f.sqlite.close();
});
const count = (table: string) => f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n;

describe("attachment suite fixture lifecycle", () => {
	it("uses one final cleanup command on the verified isolated executor", async () => {
		await fixtures.setupAttachmentFixtures();
		expect(state.exec).toHaveBeenCalledTimes(4);
		expect(state.create).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("wrangler"),
			expect.any(String),
			"attachment-owned-run",
			"attachment-owned.toml",
		);
		await fixtures.cleanupAttachmentFixtures();
		expect(state.exec).toHaveBeenCalledTimes(5);
		expect(state.create).toHaveBeenCalledOnce();
		expect(count("api_keys")).toBe(0);
		expect(f.sqlite.prepare("SELECT id FROM spaces WHERE id = 'unrelated'").get()).toMatchObject({
			id: "unrelated",
		});
	});

	it("does no work if setup never acquired an owned executor", async () => {
		await fixtures.cleanupAttachmentFixtures();
		expect(state.exec).not.toHaveBeenCalled();
		expect(state.create).not.toHaveBeenCalled();
	});

	it("keeps per-case isolation and cleans failed bodies plus replay records", async () => {
		const { keyId } = await fixtures.setupAttachmentFixtures();
		f.sqlite.exec(`INSERT INTO attachments VALUES ('m5-fixture-att', 'meme2e000001', 'att/fixture', 'a.png', 'image/png', 1, 'h', 'key:fixture', 1, NULL);
		INSERT INTO changes(entity, entity_id, space_id, op, actor, at) VALUES ('attachment', 'm5-fixture-att', 'spacee2e01', 'created', 'key:fixture', 1);
		INSERT INTO idempotency_records VALUES ('${keyId}', 'm5-fixture', 'hash', 201, '1', 1);
		INSERT INTO idempotency_response_chunks VALUES ('${keyId}', 'm5-fixture', 0, '{}');
		INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, created_at, updated_at) VALUES ('unrelated', 'unrelated', 'h', 'admin', 'r', 'all', 1, 1);
		INSERT INTO idempotency_records VALUES ('unrelated', 'prior', 'hash', 200, '1', 1);
		INSERT INTO idempotency_response_chunks VALUES ('unrelated', 'prior', 0, '{}');`);
		await fixtures.setupAttachmentFixtures();
		expect(count("attachments")).toBe(0);
		expect(count("changes")).toBe(0);
		expect(f.sqlite.prepare("SELECT key_id FROM idempotency_records").all()).toEqual([
			{ key_id: "unrelated" },
		]);
		expect(f.sqlite.prepare("SELECT key_id FROM idempotency_response_chunks").all()).toEqual([
			{ key_id: "unrelated" },
		]);
		await expect(
			(async () => {
				try {
					throw new Error("test body failed");
				} finally {
					await fixtures.cleanupAttachmentFixtures();
				}
			})(),
		).rejects.toThrow("test body failed");
		expect(f.sqlite.prepare("SELECT id FROM api_keys").all()).toEqual([{ id: "unrelated" }]);
		expect(
			f.sqlite.prepare("SELECT id FROM memories WHERE id = 'meme2e000001'").get(),
		).toBeUndefined();
		expect(f.sqlite.prepare("SELECT id FROM spaces WHERE id = 'spacee2e01'").get()).toBeUndefined();
	});

	it("cleans partial setup when seeding fails", async () => {
		const execute = state.exec.getMockImplementation();
		state.exec.mockImplementation(async (args) => {
			if (args[1]?.includes("INSERT INTO memories")) throw new Error("memory seed failed");
			return execute?.(args) ?? "";
		});
		await expect(fixtures.setupAttachmentFixtures()).rejects.toThrow("memory seed failed");
		expect(count("api_keys")).toBe(1);
		const calls = state.exec.mock.calls.length;
		await fixtures.cleanupAttachmentFixtures();
		expect(state.exec.mock.calls.length).toBe(calls + 1);
		expect(count("api_keys")).toBe(0);
	});

	it.each(["foreign", "missing", "table missing"])(
		"refuses cleanup after marker becomes %s",
		async (mode) => {
			await fixtures.setupAttachmentFixtures();
			if (mode === "foreign") f.sqlite.exec("UPDATE _test_marker SET value = 'production'");
			else if (mode === "missing") f.sqlite.exec("DELETE FROM _test_marker");
			else f.sqlite.exec("DROP TABLE _test_marker");
			await expect(fixtures.cleanupAttachmentFixtures()).rejects.toThrow();
			if (mode === "foreign")
				expect(f.sqlite.prepare("SELECT value FROM _test_marker").get()).toMatchObject({
					value: "production",
				});
			if (mode === "missing") expect(count("_test_marker")).toBe(0);
			expect(count("api_keys")).toBe(1);
			expect(
				f.sqlite.prepare("SELECT id FROM memories WHERE id = 'meme2e000001'").get(),
			).toMatchObject({ id: "meme2e000001" });
		},
	);

	it("rejects foreign ownership before setup writes and teardown work", async () => {
		f.sqlite.exec("UPDATE _test_marker SET value = 'production'");
		await expect(fixtures.setupAttachmentFixtures()).rejects.toThrow("_test_marker");
		const calls = state.exec.mock.calls.length;
		await fixtures.cleanupAttachmentFixtures();
		expect(state.exec.mock.calls.length).toBe(calls);
		expect(count("api_keys")).toBe(0);
	});

	it("awaits and propagates final cleanup failure", async () => {
		await fixtures.setupAttachmentFixtures();
		let release!: () => void;
		let started!: () => void;
		const begin = new Promise<void>((resolve) => {
			started = resolve;
		});
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const execute = state.exec.getMockImplementation();
		state.exec.mockImplementation(async (args) => {
			if (args[1]?.includes("DELETE FROM attachments")) {
				started();
				await pending;
				throw new Error("cleanup failed");
			}
			return execute?.(args) ?? "";
		});
		let done = false;
		const close = fixtures.cleanupAttachmentFixtures();
		void close.then(
			() => {
				done = true;
			},
			() => {
				done = true;
			},
		);
		await begin;
		expect(done).toBe(false);
		expect(count("api_keys")).toBe(1);
		release();
		await expect(close).rejects.toThrow("cleanup failed");
	});
});
