import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { D1_MAX_BOUND_PARAMS } from "../../lib/d1";

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
				if (args.length > D1_MAX_BOUND_PARAMS) {
					throw new Error(`D1 bound parameter limit exceeded: ${args.length}`);
				}
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
	const directory = join(dirname(fileURLToPath(import.meta.url)), "../../../../../../migrations");
	for (const file of readdirSync(directory)
		.filter((file) => file.endsWith(".sql"))
		.sort()) {
		raw.exec(readFileSync(join(directory, file), "utf8"));
	}
	return { raw, d1: sqliteD1(raw) };
}

export function openTestD1(): D1Database {
	const { raw, d1 } = migratedSqlite();
	raw.exec("PRAGMA foreign_keys = ON;");
	return d1;
}

export async function insertSpace(
	db: D1Database,
	row: { id: string; slug: string; name?: string; ownerKeyId?: string | null; now?: number },
): Promise<void> {
	const now = row.now ?? 1;
	await db
		.prepare(
			"INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?)",
		)
		.bind(row.id, row.slug, row.name ?? row.slug, row.ownerKeyId ?? null, now, now)
		.run();
}

export async function insertTinyProfile(db: D1Database): Promise<void> {
	await db
		.prepare(
			"INSERT INTO embedding_profiles (id, model, dims, metric, vectorize_index, active, created_at) VALUES ('tiny-3', 'tiny', 3, 'cosine', 'x', 0, 1)",
		)
		.run();
}
