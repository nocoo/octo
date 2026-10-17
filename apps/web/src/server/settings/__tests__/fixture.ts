import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrationSqlForNode } from "../../../../../../scripts/sqlite-test";
import type { Env } from "../../env";
import { sqliteD1 } from "../../repo/__tests__/sqlite-d1";

export const MASTER_KEY = btoa("0123456789abcdef0123456789abcdef");
export const SECRET = "gateway-private-credential-ABCD";
export const SETTINGS = {
	base_url: "https://gateway.example",
	model: "tiny",
	dims: 3,
	api_key: SECRET,
	backfill_enabled: true,
};

export function fixture() {
	const raw = new DatabaseSync(":memory:");
	for (const file of readdirSync("migrations")
		.filter((filename) => filename.endsWith(".sql"))
		.sort()) {
		raw.exec(migrationSqlForNode(readFileSync(`migrations/${file}`, "utf8")));
	}
	raw.exec(
		"CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO _test_marker (key, value) VALUES ('env', 'test');",
	);
	raw.exec("UPDATE embedding_profiles SET active = 0;");
	raw.exec("INSERT INTO embedding_profiles VALUES ('tiny', 'tiny', 3, 'cosine', 'tiny', 1, 1);");
	const env = { DB: sqliteD1(raw), RESOURCE_ENV: "test", OCTO_SETTINGS_KEY: MASTER_KEY } as Env;
	return { raw, env };
}
