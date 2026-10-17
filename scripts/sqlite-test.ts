import { DatabaseSync } from "node:sqlite";

export function sqliteSupportsFts5(): boolean {
	const db = new DatabaseSync(":memory:");
	try {
		db.exec("CREATE VIRTUAL TABLE fts_probe USING fts5(content);");
		return true;
	} catch {
		return false;
	} finally {
		db.close();
	}
}

export function migrationSqlForNodeWithSupport(sql: string, supported: boolean): string {
	if (supported) {
		return sql;
	}
	return sql.replace(
		/CREATE VIRTUAL TABLE memories_fts[\s\S]*?;/,
		"-- skipped memories_fts: fts5 unavailable in this sqlite build",
	);
}

export function migrationSqlForNode(sql: string): string {
	return migrationSqlForNodeWithSupport(sql, sqliteSupportsFts5());
}
