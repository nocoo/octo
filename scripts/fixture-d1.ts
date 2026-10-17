import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { D1Database } from "@cloudflare/workers-types";
import { parse } from "smol-toml";
import { valueHasRemoteTrue } from "./gate-no-remote";
import type { AsyncD1Exec } from "./local-d1";

export type FixtureD1Session = { exec: AsyncD1Exec; dispose: () => Promise<void> };

function assertRunPaths(persist: string, config: string): void {
	if (
		!isAbsolute(persist) ||
		!isAbsolute(config) ||
		basename(dirname(persist)) !== "e2e" ||
		basename(dirname(dirname(persist))) !== ".wrangler" ||
		config !== join(dirname(dirname(persist)), "e2e-run", basename(persist), "wrangler.toml")
	)
		throw new Error("fixture D1 requires matching isolated run paths");
}

async function assertIsolatedStore(path: string): Promise<void> {
	const entry = await lstat(path);
	if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink > 1)) {
		throw new Error("fixture D1 storage must be isolated without linked entries");
	}
	if (entry.isDirectory()) {
		for (const name of await readdir(path)) await assertIsolatedStore(join(path, name));
	}
}

async function assertMarker(db: D1Database): Promise<void> {
	try {
		if (
			(
				await db
					.prepare("SELECT value FROM _test_marker WHERE key = 'env'")
					.first<{ value: string }>()
			)?.value === "test"
		)
			return;
	} catch {}
	throw new Error("refusing fixture SQL without _test_marker env=test");
}

export async function openFixtureD1(
	persist: string,
	configPath: string,
): Promise<FixtureD1Session> {
	assertRunPaths(persist, configPath);
	const [persistRoot, config, state] = await Promise.all([
		realpath(persist),
		realpath(configPath),
		realpath(join(persist, "v3")),
	]);
	assertRunPaths(persistRoot, config);
	if (state !== join(persistRoot, "v3")) throw new Error("fixture D1 persistence must be isolated");
	const settings = parse(await readFile(config, "utf8"));
	const databases = settings.d1_databases;
	if (
		valueHasRemoteTrue(settings) ||
		settings.vectorize ||
		settings.routes ||
		!Array.isArray(databases) ||
		databases.length !== 1 ||
		(databases[0] as Record<string, unknown>).binding !== "DB"
	) {
		throw new Error("unsafe fixture D1 configuration");
	}
	await assertIsolatedStore(state);
	const { getPlatformProxy, unstable_splitSqlQuery } = await import("wrangler");
	const proxy = await getPlatformProxy<{ DB: D1Database }>({
		configPath: config,
		persist: { path: state },
		remoteBindings: false,
		envFiles: [],
	});
	try {
		await assertMarker(proxy.env.DB);
	} catch (err) {
		await proxy.dispose();
		throw err;
	}
	let disposed = false;
	return {
		async exec(args) {
			if (disposed) throw new Error("fixture D1 runtime disposed");
			if (
				args[0] !== "--command" ||
				!args[1]?.trim() ||
				args.length > 3 ||
				(args.length === 3 && args[2] !== "--json")
			)
				throw new Error("expected fixture SQL command");
			await assertMarker(proxy.env.DB);
			const statements = unstable_splitSqlQuery(args[1]);
			return JSON.stringify(
				await proxy.env.DB.batch(statements.map((sql) => proxy.env.DB.prepare(sql))),
			);
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			await proxy.dispose();
		},
	};
}
