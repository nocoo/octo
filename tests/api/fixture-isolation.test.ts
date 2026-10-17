import { link, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { type FixtureD1Session, openFixtureD1 } from "../../scripts/fixture-d1";

vi.mock("wrangler", async (importOriginal) => {
	const actual = await importOriginal<typeof import("wrangler")>();
	return { ...actual, getPlatformProxy: vi.fn(actual.getPlatformProxy) };
});

async function runPaths(base: string, name: string) {
	const persist = join(base, ".wrangler/e2e", name);
	const configPath = join(base, ".wrangler/e2e-run", name, "wrangler.toml");
	await mkdir(join(persist, "v3"), { recursive: true });
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(
		configPath,
		`name = "octo-isolation-${name.toLowerCase()}"
compatibility_date = "2026-04-01"
[[d1_databases]]
binding = "DB"
database_name = "octo-db"
database_id = "11111111-1111-1111-1111-111111111111"
`,
	);
	return { persist, configPath };
}
async function localProxy(paths: Awaited<ReturnType<typeof runPaths>>) {
	return getPlatformProxy<{ DB: D1Database }>({
		configPath: paths.configPath,
		persist: { path: join(paths.persist, "v3") },
		remoteBindings: false,
		envFiles: [],
	});
}
async function marker(db: D1Database) {
	expect(await db.prepare("SELECT value FROM _test_marker WHERE key = 'env'").first()).toEqual({
		value: "test",
	});
}
async function seed(paths: Awaited<ReturnType<typeof runPaths>>, value: string) {
	const proxy = await localProxy(paths);
	try {
		await proxy.env.DB.batch([
			proxy.env.DB.prepare("CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
			proxy.env.DB.prepare("INSERT INTO _test_marker VALUES ('env', 'test')"),
		]);
		await marker(proxy.env.DB);
		await proxy.env.DB.batch([
			proxy.env.DB.prepare("CREATE TABLE canary (value TEXT NOT NULL)"),
			proxy.env.DB.prepare("INSERT INTO canary VALUES (?)").bind(value),
		]);
	} finally {
		await proxy.dispose();
	}
}
async function observe(paths: Awaited<ReturnType<typeof runPaths>>) {
	const proxy = await localProxy(paths);
	try {
		await marker(proxy.env.DB);
		return (
			await proxy.env.DB.prepare("SELECT value FROM canary ORDER BY rowid").all<{ value: string }>()
		).results;
	} finally {
		await proxy.dispose();
	}
}

describe("real SDK run storage isolation", () => {
	it.each(["d1-root", "d1-directory", "sqlite-symlink", "sqlite-hardlink", "normal"])(
		"protects run A canary from run B %s storage",
		async (kind) => {
			const base = await realpath(await mkdtemp(join(tmpdir(), "octo-sdk-store-isolation-")));
			let session: FixtureD1Session | undefined;
			try {
				const a = await runPaths(base, "A");
				const b = await runPaths(base, "B");
				await seed(a, "A-original");
				await seed(b, "B-original");
				const d1 = join(a.persist, "v3/d1");
				const leaves = (await readdir(d1, { recursive: true })).filter(
					(name) => name.endsWith(".sqlite") && basename(name) !== "metadata.sqlite",
				);
				expect(leaves).toHaveLength(1);
				const leaf = leaves[0] as string;
				if (kind !== "normal") {
					const suffix =
						kind === "d1-root"
							? "d1"
							: kind === "d1-directory"
								? join("d1", dirname(leaf))
								: join("d1", leaf);
					const destination = join(b.persist, "v3", suffix);
					const source = join(a.persist, "v3", suffix);
					await rm(destination, { recursive: true, force: true });
					if (kind === "sqlite-hardlink") {
						await rm(`${destination}-wal`, { force: true });
						await rm(`${destination}-shm`, { force: true });
						await link(source, destination);
					} else await symlink(source, destination);
				}
				const before = vi.mocked(getPlatformProxy).mock.calls.length;
				let rejected = false;
				try {
					session = await openFixtureD1(b.persist, b.configPath);
					await session.exec(["--command", "INSERT INTO canary VALUES ('B-write')"]);
				} catch (err) {
					rejected = err instanceof Error && err.message.includes("isolated");
				} finally {
					await session?.dispose();
					session = undefined;
				}
				const calls = vi.mocked(getPlatformProxy).mock.calls.length - before;
				expect({ rejected, sdkCalls: calls, canary: await observe(a) }).toEqual({
					rejected: kind !== "normal",
					sdkCalls: kind === "normal" ? 1 : 0,
					canary: [{ value: "A-original" }],
				});
				if (kind === "normal")
					expect(await observe(b)).toEqual([{ value: "B-original" }, { value: "B-write" }]);
			} finally {
				await session?.dispose();
				await rm(base, { recursive: true, force: true });
			}
		},
	);
});
