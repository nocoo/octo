import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrationSqlForNode } from "./sqlite-test";

it("adds tag positions without removing existing associations or version snapshots", () => {
	const raw = new DatabaseSync(":memory:");
	try {
		raw.exec(migrationSqlForNode(readFileSync("migrations/0001_core.sql", "utf8")));
		raw.exec(`
			INSERT INTO spaces (id,slug,name,created_at,updated_at) VALUES ('s','s','s',1,1);
			INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
			VALUES ('m','s','','','note','k','h',1,1);
			INSERT INTO tags (id,name,display_name,created_at,updated_at) VALUES ('z','zulu','Zulu',1,1), ('a','alpha','Alpha',1,1);
			INSERT INTO memory_tags VALUES ('m','z'), ('m','a');
			INSERT INTO memory_versions (memory_id,version,title,body,type,importance,tags_json,space_id,actor,op,created_at)
			VALUES ('m',1,'','','note',0.5,'["zulu","alpha"]','s','key:k','create',1);
		`);
		raw.exec(readFileSync("migrations/0006_tag_positions.sql", "utf8"));
		expect(raw.prepare("SELECT tag_id,position FROM memory_tags ORDER BY position").all()).toEqual([
			{ tag_id: "a", position: 0 },
			{ tag_id: "z", position: 1 },
		]);
		expect(raw.prepare("SELECT tags_json FROM memory_versions").get()).toEqual({
			tags_json: '["zulu","alpha"]',
		});
	} finally {
		raw.close();
	}
});
