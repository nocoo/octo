import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
	applyMigrations,
	assertAsyncTestMarker,
	assertTestMarker,
	createD1Exec,
	ensureLocalSchema,
	readTestMarkerValue,
	tableExists,
	wranglerD1Args,
	writeTestMarker,
} from "./local-d1";
import { migrationSqlForNode } from "./sqlite-test";

const execute = vi.hoisted(() => vi.fn(() => "[]"));
vi.mock("node:child_process", () => ({ execFileSync: execute }));

describe("local-d1", () => {
	it("builds local-only wrangler args", () => {
		expect(wranglerD1Args(["--command", "SELECT 1"])).toEqual([
			"d1",
			"execute",
			"octo-db",
			"--local",
			"--command",
			"SELECT 1",
		]);
		expect(wranglerD1Args(["--json"], "persist", "cfg.toml")).toEqual([
			"d1",
			"execute",
			"octo-db",
			"--local",
			"--persist-to=persist",
			"--config=cfg.toml",
			"--json",
		]);
		expect(wranglerD1Args([], "", "")).toEqual(["d1", "execute", "octo-db", "--local"]);
	});

	it("applies core schema once and requires the test marker", () => {
		const db = new DatabaseSync(":memory:");
		const d1 = (args: string[]): string => {
			const file = args.find((arg) => arg.startsWith("--file="));
			if (file) {
				const path = file.slice("--file=".length);
				let sql = readFileSync(path, "utf8");
				if (path.endsWith("0001_core.sql")) {
					sql = migrationSqlForNode(sql);
				}
				db.exec(sql);
				return "";
			}
			const query = args[args.indexOf("--command") + 1];
			if (!query) {
				throw new Error("missing command");
			}
			if (query.startsWith("CREATE TABLE") || query.startsWith("INSERT ")) {
				db.exec(query);
				return "";
			}
			const rows = db.prepare(query).all();
			return JSON.stringify([{ results: rows }]);
		};
		expect(tableExists(d1, "spaces")).toBe(false);
		applyMigrations(d1);
		expect(tableExists(d1, "spaces")).toBe(true);
		expect(
			db
				.prepare(
					"SELECT name FROM pragma_table_info('vector_sync_jobs') WHERE name IN ('attempts', 'last_error', 'dead_at')",
				)
				.all(),
		).toHaveLength(3);
		db.exec("UPDATE search_backfill_state SET memory_cursor='kept', complete=1 WHERE id=1");
		db.exec(`INSERT INTO spaces (id,slug,name,created_at,updated_at) VALUES ('order','order','Order',1,1);
			INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at) VALUES ('order','order','','','note','key','hash',1,1);
			INSERT INTO tags (id,name,display_name,created_at,updated_at) VALUES ('order','order','Order',1,1);
			INSERT INTO memory_tags (memory_id,tag_id,position) VALUES ('order','order',7);`);
		applyMigrations(d1);
		expect(
			db
				.prepare(
					"SELECT attempts, last_error, dead_at FROM vector_sync_jobs WHERE memory_id = 'order'",
				)
				.get(),
		).toEqual({ attempts: 0, last_error: null, dead_at: null });
		expect(db.prepare("SELECT memory_cursor, complete FROM search_backfill_state").get()).toEqual({
			memory_cursor: "kept",
			complete: 1,
		});
		expect(db.prepare("SELECT position FROM memory_tags WHERE memory_id = 'order'").get()).toEqual({
			position: 7,
		});
		expect(() => assertTestMarker(d1)).toThrow("_test_marker");
		writeTestMarker(d1);
		expect(readTestMarkerValue(d1)).toBe("test");
		assertTestMarker(d1);
		writeTestMarker(d1);
		expect(readTestMarkerValue(d1)).toBe("test");
		db.close();
	});

	it("applies later sql files after core", async () => {
		const dir = join(tmpdir(), `octo-mig-${Date.now()}`);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "0001_core.sql"), "SELECT 1;\n");
		await writeFile(join(dir, "0002_extra.sql"), "CREATE TABLE extra (id TEXT);\n");
		const applied: string[] = [];
		const d1 = (args: string[]): string => {
			const file = args.find((arg) => arg.startsWith("--file="));
			if (file) {
				applied.push(file.slice("--file=".length));
				return "";
			}
			return JSON.stringify([{ results: [] }]);
		};
		try {
			applyMigrations(d1, dir);
			expect(applied.some((path) => path.endsWith("0001_core.sql"))).toBe(true);
			expect(applied.some((path) => path.endsWith("0002_extra.sql"))).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("treats missing json as absent tables and markers", () => {
		const d1 = () => "not json";
		expect(tableExists(d1, "spaces")).toBe(false);
		expect(readTestMarkerValue(d1)).toBeNull();
	});

	it("createD1Exec shells out locally", () => {
		execute.mockReturnValue("[]");
		const d1 = createD1Exec("/bin/echo", "/tmp", "persist", "cfg.toml");
		expect(d1(["--json"])).toBe("[]");
		expect(execute).toHaveBeenCalled();
		ensureLocalSchema();
	});

	it("requires the async fixture marker before mutations", async () => {
		const d1 = vi.fn(async () => '[{"results":[{"value":"test"}]}]');
		await expect(assertAsyncTestMarker(d1)).resolves.toBeUndefined();
		expect(d1).toHaveBeenCalledWith([
			"--command",
			"SELECT value FROM _test_marker WHERE key = 'env'",
			"--json",
		]);
		for (const output of ['[{"results":[{"value":"prod"}]}]', "[]", "not json"]) {
			await expect(assertAsyncTestMarker(async () => output)).rejects.toThrow("env=test");
		}
	});

	it("refuses a marker that is not env=test", () => {
		const d1 = (args: string[]): string => {
			if (args.includes("--json")) {
				return JSON.stringify([{ results: [{ value: "prod" }] }]);
			}
			return "";
		};
		expect(readTestMarkerValue(d1)).toBe("prod");
		expect(() => assertTestMarker(d1)).toThrow(
			"refusing to mutate D1 without _test_marker env=test",
		);
		expect(() => writeTestMarker(d1)).toThrow("refusing to overwrite _test_marker");
	});

	it("treats empty result sets as missing tables and markers", () => {
		const empty = () => JSON.stringify([{ results: [] }]);
		expect(tableExists(empty, "spaces")).toBe(false);
		expect(readTestMarkerValue(empty)).toBeNull();
		expect(tableExists(() => JSON.stringify([{}]), "spaces")).toBe(false);
	});
});
