import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { CORE_MIGRATION } from "../../../../../../scripts/schema";

type Bound = {
	sql: string;
	binds: SQLInputValue[];
	bind: (...args: SQLInputValue[]) => Bound;
	first: <T>() => Promise<T | null>;
	all: <T>() => Promise<{ results: T[] }>;
	run: () => Promise<{ success: true; meta: { changes: number } }>;
};

export function sqliteD1(db: DatabaseSync): D1Database {
	const prepare = (sql: string): Bound => {
		const stmt: Bound = {
			sql,
			binds: [],
			bind(...args: SQLInputValue[]) {
				this.binds = args;
				return this;
			},
			async first<T>() {
				const row = db.prepare(sql).get(...this.binds) as T | undefined;
				return row ?? null;
			},
			async all<T>() {
				return { results: db.prepare(sql).all(...this.binds) as T[] };
			},
			async run() {
				const prepared = db.prepare(sql);
				prepared.setReadBigInts(true);
				const info = prepared.run(...this.binds);
				return { success: true as const, meta: { changes: Number(info.changes) } };
			},
		};
		return stmt;
	};
	return {
		prepare,
		async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
			db.exec("BEGIN");
			try {
				const out: unknown[] = [];
				for (const stmt of stmts) {
					out.push(await stmt.run());
				}
				db.exec("COMMIT");
				return out as D1Result[];
			} catch (err) {
				db.exec("ROLLBACK");
				throw err;
			}
		},
	} as unknown as D1Database;
}

export function migratedSqlite(): { raw: DatabaseSync; d1: D1Database } {
	const raw = new DatabaseSync(":memory:");
	raw.exec(
		readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), "../../../../../../", CORE_MIGRATION),
			"utf8",
		),
	);
	return { raw, d1: sqliteD1(raw) };
}
