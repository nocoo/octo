import { sqliteD1 } from "../../../../../../tests/fixtures/sqlite-d1";
import { execution, testApp, testEnv } from "./app";

export function queryFixture() {
	const { db, sqlite } = sqliteD1();
	return { db, sqlite, env: testEnv(db), app: testApp(), ...execution() };
}

export function auditRow(
	sqlite: ReturnType<typeof sqliteD1>["sqlite"],
	row: {
		id: string;
		at?: number;
		actor?: string;
		method?: string;
		route?: string;
		status?: number;
		bytes_in?: number | null;
		bytes_out?: number | null;
	},
) {
	sqlite
		.prepare(`INSERT INTO audit_log (id, at, actor, method, route, status, request_id, duration_ms, bytes_in, bytes_out)
	VALUES (?, ?, ?, ?, ?, ?, 'request', 1, ?, ?)`)
		.run(
			row.id,
			row.at ?? Date.UTC(2026, 9, 17),
			row.actor ?? "key:AAAAAAAAAAAA",
			row.method ?? "GET",
			row.route ?? "/api/v1/memories/:id",
			row.status ?? 200,
			row.bytes_in ?? null,
			row.bytes_out ?? null,
		);
}
