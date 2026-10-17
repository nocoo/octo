import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openFixtureD1, waitForFixtureBackground } from "./fixture-d1";

const platform = vi.hoisted(() => ({ open: vi.fn(), split: vi.fn<(sql: string) => string[]>() }));
vi.mock("wrangler", () => ({
	getPlatformProxy: platform.open,
	unstable_splitSqlQuery: platform.split,
}));
const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
	platform.open.mockReset();
	platform.split.mockReset().mockImplementation((sql) => [sql]);
});

const safeConfig = `name = "octo-fixture"
compatibility_date = "2026-04-01"
[[d1_databases]]
binding = "DB"
database_name = "octo-db"
database_id = "11111111-1111-1111-1111-111111111111"
`;
async function layout(config = safeConfig) {
	const base = await realpath(await mkdtemp(join(tmpdir(), "octo-fixture-proxy-")));
	dirs.push(base);
	const persist = join(base, ".wrangler/e2e/run");
	const configPath = join(base, ".wrangler/e2e-run/run/wrangler.toml");
	await mkdir(join(persist, "v3"), { recursive: true });
	await mkdir(join(base, ".wrangler/e2e-run/run"), { recursive: true });
	await writeFile(configPath, config);
	return { base, persist, configPath };
}
function binding() {
	const first = vi.fn(async (): Promise<unknown> => ({ value: "test" }));
	const prepare = vi.fn((sql: string) => ({ sql, first }));
	const batch = vi.fn(async (_statements: unknown[]) => [{ results: [{ n: 1 }], success: true }]);
	const dispose = vi.fn(async () => {});
	platform.open.mockResolvedValue({ env: { DB: { prepare, batch } }, dispose });
	return { first, prepare, batch, dispose };
}

describe("official local fixture D1 runtime", () => {
	it("awaits the worker background barrier before using shared local storage", async () => {
		const request = vi.fn(async () => Response.json({ drained: true }));
		await waitForFixtureBackground("http://127.0.0.1:17059", request);
		expect(request).toHaveBeenCalledExactlyOnceWith(
			"http://127.0.0.1:17059/api/__test/background",
			{ method: "POST" },
		);
		await expect(
			waitForFixtureBackground(
				"http://127.0.0.1:17059",
				async () => new Response("missing", { status: 404 }),
			),
		).rejects.toThrow("background barrier failed");
	});

	it("shares CLI v3 persistence with explicit local-only options and uses the official SQL splitter", async () => {
		const f = await layout();
		const b = binding();
		const session = await openFixtureD1(f.persist, f.configPath);
		expect(platform.open).toHaveBeenCalledExactlyOnceWith({
			configPath: f.configPath,
			persist: { path: join(f.persist, "v3") },
			remoteBindings: false,
			envFiles: [],
		});
		const sql =
			"INSERT INTO t VALUES ('quoted ; text'); CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; SELECT 2; END; SELECT 3;";
		platform.split.mockReturnValueOnce([
			"INSERT INTO t VALUES ('quoted ; text')",
			"CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; SELECT 2; END",
			"SELECT 3",
		]);
		expect(JSON.parse(await session.exec(["--command", sql, "--json"]))).toEqual([
			{ results: [{ n: 1 }], success: true },
		]);
		expect(b.batch.mock.calls[0]?.[0]).toEqual([
			expect.objectContaining({ sql: "INSERT INTO t VALUES ('quoted ; text')" }),
			expect.objectContaining({
				sql: "CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; SELECT 2; END",
			}),
			expect.objectContaining({ sql: "SELECT 3" }),
		]);
		expect(platform.split).toHaveBeenCalledExactlyOnceWith(sql);
		expect(b.first).toHaveBeenCalledTimes(2);
		await session.dispose();
		await session.dispose();
		expect(b.dispose).toHaveBeenCalledTimes(1);
		await expect(session.exec(["--command", "SELECT 1"])).rejects.toThrow("disposed");
	});

	it.each([null, { value: "production" }, {}])(
		"disposes immediately for a foreign or missing marker %j",
		async (marker) => {
			const f = await layout();
			const b = binding();
			b.first.mockResolvedValue(marker);
			await expect(openFixtureD1(f.persist, f.configPath)).rejects.toThrow("env=test");
			expect(b.batch).not.toHaveBeenCalled();
			expect(b.dispose).toHaveBeenCalledTimes(1);
		},
	);
	it("disposes on marker read errors and never retries runtime startup failures", async () => {
		const f = await layout();
		const b = binding();
		b.first.mockRejectedValue(new Error("missing table"));
		await expect(openFixtureD1(f.persist, f.configPath)).rejects.toThrow("env=test");
		expect(b.dispose).toHaveBeenCalledTimes(1);
		platform.open.mockRejectedValueOnce(new Error("runtime failed"));
		await expect(openFixtureD1(f.persist, f.configPath)).rejects.toThrow("runtime failed");
		expect(platform.open).toHaveBeenCalledTimes(2);
	});
	it("checks ownership before every SQL operation and propagates execution failures without retry", async () => {
		const f = await layout();
		const b = binding();
		const session = await openFixtureD1(f.persist, f.configPath);
		try {
			b.first.mockResolvedValueOnce({ value: "production" });
			await expect(session.exec(["--command", "DELETE FROM t"])).rejects.toThrow("env=test");
			expect(b.batch).not.toHaveBeenCalled();
			b.batch.mockRejectedValueOnce(new Error("SQL failed"));
			await expect(session.exec(["--command", "DELETE FROM t"])).rejects.toThrow("SQL failed");
			expect(b.batch).toHaveBeenCalledTimes(1);
		} finally {
			await session.dispose();
		}
	});
	it.each(
		[
			[],
			["--json"],
			["--command"],
			["--command", ""],
			["--command", "SELECT 1", "extra"],
			["--command", "SELECT 1", "--json", "extra"],
		].map((args) => ({ args })),
	)("rejects unsupported fixture arguments $args", async ({ args }) => {
		const f = await layout();
		const b = binding();
		const session = await openFixtureD1(f.persist, f.configPath);
		try {
			await expect(session.exec(args)).rejects.toThrow("fixture SQL");
			expect(b.batch).not.toHaveBeenCalled();
		} finally {
			await session.dispose();
		}
	});
	it("surfaces disposal failure rather than silently leaking a runtime", async () => {
		const f = await layout();
		const b = binding();
		const session = await openFixtureD1(f.persist, f.configPath);
		b.dispose.mockRejectedValueOnce(new Error("dispose failed"));
		await expect(session.dispose()).rejects.toThrow("dispose failed");
	});

	it.each(["relative", "daily", "other-run", "other-config"])(
		"rejects unsafe %s paths before booting",
		async (kind) => {
			const f = await layout();
			binding();
			const persist =
				kind === "relative"
					? "state"
					: kind === "daily"
						? join(f.base, ".wrangler/state")
						: f.persist;
			const configPath =
				kind === "other-run"
					? f.configPath.replace("e2e-run/run/", "e2e-run/other/")
					: kind === "other-config"
						? join(f.base, "wrangler.toml")
						: f.configPath;
			await expect(openFixtureD1(persist, configPath)).rejects.toThrow("isolated");
			expect(platform.open).not.toHaveBeenCalled();
		},
	);
	it.each(["config", "v3"])("rejects %s symlink escapes before booting", async (kind) => {
		const f = await layout();
		binding();
		if (kind === "v3") {
			await rm(join(f.persist, "v3"), { recursive: true });
			await symlink(f.base, join(f.persist, "v3"));
		} else {
			await rm(f.configPath);
			await writeFile(join(f.base, "other.toml"), safeConfig);
			await symlink(join(f.base, "other.toml"), f.configPath);
		}
		await expect(openFixtureD1(f.persist, f.configPath)).rejects.toThrow("isolated");
		expect(platform.open).not.toHaveBeenCalled();
	});
	it.each([
		{ path: "d1", hardlink: false },
		{ path: "d1/miniflare-D1DatabaseObject", hardlink: false },
		{ path: "d1/miniflare-D1DatabaseObject/store.sqlite", hardlink: false },
		{ path: "d1/miniflare-D1DatabaseObject/store.sqlite", hardlink: true },
	])(
		"rejects nested storage alias $path (hardlink=$hardlink) before the SDK",
		async ({ path, hardlink }) => {
			const a = await layout();
			const b = await layout();
			const leaf = join(a.persist, "v3/d1/miniflare-D1DatabaseObject/store.sqlite");
			await mkdir(dirname(leaf), { recursive: true });
			await writeFile(leaf, "original canary");
			const destination = join(b.persist, "v3", path);
			await mkdir(dirname(destination), { recursive: true });
			if (hardlink) await link(leaf, destination);
			else await symlink(join(a.persist, "v3", path), destination);
			binding();
			await expect(openFixtureD1(b.persist, b.configPath)).rejects.toThrow("isolated");
			expect(platform.open).not.toHaveBeenCalled();
			expect(await readFile(leaf, "utf8")).toBe("original canary");
		},
	);
	it("accepts ordinary nested directories and singly linked SQLite files", async () => {
		const f = await layout();
		const leaf = join(f.persist, "v3/d1/miniflare-D1DatabaseObject/store.sqlite");
		await mkdir(dirname(leaf), { recursive: true });
		await writeFile(leaf, "normal file");
		const b = binding();
		const session = await openFixtureD1(f.persist, f.configPath);
		await session.dispose();
		expect(b.dispose).toHaveBeenCalledTimes(1);
	});

	it.each([
		"invalid = [",
		safeConfig + ["remote", " = ", "true"].join(""),
		`${safeConfig}\n[[vectorize]]\nbinding="VEC"\nindex_name="unsupported"\n`,
		`${safeConfig}\n[[routes]]\npattern="example.com"\n`,
		safeConfig.replace('binding = "DB"', 'binding = "OTHER"'),
		safeConfig.replace("[[d1_databases]]", "[[other_databases]]"),
	])("rejects unsafe configuration before runtime creation", async (config) => {
		const f = await layout(config);
		binding();
		await expect(openFixtureD1(f.persist, f.configPath)).rejects.toThrow();
		expect(platform.open).not.toHaveBeenCalled();
	});
});
