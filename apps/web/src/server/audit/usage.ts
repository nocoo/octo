export async function rollupUsage(db: D1Database): Promise<void> {
	await db
		.prepare(
			`INSERT INTO usage_daily (day, key_id, calls, errors, writes, bytes_in, bytes_out)
			SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch'), substr(actor, 5),
				COUNT(*), SUM(status >= 400 OR error_code IS NOT NULL),
				SUM(CASE WHEN status >= 200 AND status < 400
					AND error_code IS NULL
					AND ((route = '/mcp' AND EXISTS
						(SELECT 1 FROM mcp_audit_writes WHERE audit_id = audit_log.id)) OR
						(route <> '/mcp' AND method IN ('POST', 'PUT', 'PATCH', 'DELETE')
						AND route NOT IN ('/api/v1/search', '/api/v1/memories:batchGet')))
					THEN 1 ELSE 0 END),
				SUM(COALESCE(bytes_in, 0)), SUM(COALESCE(bytes_out, 0))
			FROM audit_log WHERE actor LIKE 'key:%' AND length(actor) > 4
			GROUP BY 1, 2
			ON CONFLICT(day, key_id) DO UPDATE SET
				calls = excluded.calls, errors = excluded.errors, writes = excluded.writes,
				bytes_in = excluded.bytes_in, bytes_out = excluded.bytes_out`,
		)
		.run();
}
