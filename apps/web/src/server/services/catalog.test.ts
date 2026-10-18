import { describe, expect, it } from "vitest";
import { migratedSqlite } from "../repo/__tests__/sqlite-d1";
import { testApiPrincipal } from "../test-principal";
import { listTags } from "./catalog";

describe("visible tag catalog", () => {
	it("hides unused, trashed-only and invisible tags while preserving admin inventory", async () => {
		const { raw, d1 } = migratedSqlite();
		try {
			raw.exec(`
				INSERT INTO spaces (id,slug,name,description,created_at,updated_at)
				VALUES ('visible','visible','Visible','',1,1), ('hidden','hidden','Hidden','',1,1);
				INSERT INTO tags (id,name,display_name,created_at,updated_at) VALUES
				('shared','shared','shared',1,1), ('hidden','hidden','hidden',1,1),
				('unused','unused','unused',1,1), ('trashed','trashed','trashed',1,1);
				INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at,deleted_at)
				VALUES ('live','visible','','','note','kid','h',1,1,NULL),
				('secret','hidden','','','note','kid','h',1,1,NULL),
				('trash','visible','','','note','kid','h',1,1,2);
				INSERT INTO memory_tags (memory_id,tag_id) VALUES
				('live','shared'), ('secret','shared'), ('secret','hidden'), ('trash','trashed');
			`);
			const principal = testApiPrincipal();
			for (const scope of ["spaces", "own"] as const) {
				const scoped = { ...principal, scope, spaceIds: ["visible"], ownedSpaceIds: ["visible"] };
				expect(await listTags(d1, scoped)).toEqual({
					items: [{ id: "shared", name: "shared", display_name: "shared", use_count: 1 }],
					next_cursor: null,
				});
				expect(await listTags(d1, { ...scoped, spaceIds: [], ownedSpaceIds: [] })).toEqual({
					items: [],
					next_cursor: null,
				});
			}
			expect((await listTags(d1, principal)).items).toEqual([
				{ id: "hidden", name: "hidden", display_name: "hidden", use_count: 1 },
				{ id: "shared", name: "shared", display_name: "shared", use_count: 2 },
			]);
			expect(
				(await listTags(d1, { ...principal, actor: "admin:test@example.com" })).items,
			).toHaveLength(4);
		} finally {
			raw.close();
		}
	});
});
