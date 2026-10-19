import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_MIGRATION } from "./schema";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = join(root, "node_modules/.bin/wrangler");

export type D1Exec = (args: string[]) => string;
export type AsyncD1Exec = (args: string[]) => Promise<string>;

export function wranglerD1Args(args: string[], persistTo?: string, config?: string): string[] {
	const extra: string[] = [];
	if (persistTo !== undefined && persistTo.length > 0) {
		extra.push(`--persist-to=${persistTo}`);
	}
	if (config !== undefined && config.length > 0) {
		extra.push(`--config=${config}`);
	}
	return ["d1", "execute", "octo-db", "--local", ...extra, ...args];
}

export function createD1Exec(
	bin = wranglerBin,
	cwd = root,
	persistTo?: string,
	config?: string,
): D1Exec {
	return (args: string[]): string =>
		execFileSync(bin, wranglerD1Args(args, persistTo, config), {
			cwd,
			encoding: "utf8",
		});
}

export function tableExists(d1: D1Exec, name: string): boolean {
	const stdout = d1([
		"--command",
		`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`,
		"--json",
	]);
	const start = stdout.indexOf("[");
	if (start < 0) {
		return false;
	}
	const parsed = JSON.parse(stdout.slice(start)) as Array<{ results?: Array<{ name?: string }> }>;
	const rows = parsed[0]?.results ?? [];
	return rows.some((row) => row.name === name);
}

export function applyMigrations(d1: D1Exec, migrationsDir = join(root, "migrations")): void {
	if (!tableExists(d1, "spaces")) {
		d1([`--file=${join(root, CORE_MIGRATION)}`]);
	}
	for (const file of readdirSync(migrationsDir)
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		if (file === "0001_core.sql") {
			continue;
		}
		const addedColumns = {
			"0010_vector_convergence.sql": { table: "vector_sync_jobs", names: ["visible_generation"] },
			"0006_tag_positions.sql": { table: "memory_tags", names: ["position"] },
			"0007_vector_sync_retries.sql": {
				table: "vector_sync_jobs",
				names: ["attempts", "last_error", "dead_at", "lease_dirty"],
			},
		}[file];
		if (addedColumns) {
			const output = d1([
				"--command",
				`SELECT name FROM pragma_table_info('${addedColumns.table}')`,
				"--json",
			]);
			const result = JSON.parse(output.slice(output.indexOf("["))) as Array<{
				results?: Array<{ name: string }>;
			}>;
			if (
				addedColumns.names.every((name) =>
					result[0]?.results?.some((column) => column.name === name),
				)
			)
				continue;
		}
		d1([`--file=${join(migrationsDir, file)}`]);
	}
}

export function writeTestMarker(d1: D1Exec): void {
	d1([
		"--command",
		"CREATE TABLE IF NOT EXISTS _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
	]);
	const existing = readTestMarkerValue(d1);
	if (existing === "test") {
		return;
	}
	if (existing !== null) {
		throw new Error("refusing to overwrite _test_marker");
	}
	d1(["--command", "INSERT INTO _test_marker (key, value) VALUES ('env', 'test')"]);
}

export function readTestMarkerValue(d1: D1Exec): string | null {
	return markerValue(
		d1(["--command", "SELECT value FROM _test_marker WHERE key = 'env'", "--json"]),
	);
}

function markerValue(stdout: string): string | null {
	const start = stdout.indexOf("[");
	if (start < 0) {
		return null;
	}
	const parsed = JSON.parse(stdout.slice(start)) as Array<{ results?: Array<{ value?: string }> }>;
	return parsed[0]?.results?.[0]?.value ?? null;
}

export function assertTestMarker(d1: D1Exec): void {
	const value = readTestMarkerValue(d1);
	if (value !== "test") {
		throw new Error("refusing to mutate D1 without _test_marker env=test");
	}
}

export async function assertAsyncTestMarker(d1: AsyncD1Exec): Promise<void> {
	const output = await d1([
		"--command",
		"SELECT value FROM _test_marker WHERE key = 'env'",
		"--json",
	]);
	if (markerValue(output) !== "test") {
		throw new Error("refusing to mutate D1 without _test_marker env=test");
	}
}

export function ensureLocalSchema(): void {
	applyMigrations(createD1Exec());
}
