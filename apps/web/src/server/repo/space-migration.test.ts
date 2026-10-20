import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mintApiKey } from "../auth/api-key";
import { authorize, visibleSpaceIds } from "../auth/authorize";
import { authenticateBearer } from "../auth/bearer";
import type { Env } from "../env";
import { searchAuthzFromPrincipal } from "../search/authz";
import { searchMemories } from "../search/service";
import { authzFrom, MemoryService } from "../services/memories";
import { updateManagedSpace } from "../services/space-management";
import { sqliteD1 } from "./__tests__/sqlite-d1";
import { ensureAutoOwnSpace, SpaceRepo } from "./spaces";

const migration = "0012_space_slug_aliases.sql";
const databases: DatabaseSync[] = [];
const unchangedTables = [
	"api_keys",
	"memories",
	"memory_versions",
	"attachments",
	"tags",
	"memory_tags",
	"memories_fts_map",
	"memories_words_fts",
	"search_tag_tokens",
	"memory_vectors",
	"vector_sync_jobs",
	"changes",
	"audit_log",
	"settings",
	"idempotency_records",
	"idempotency_response_chunks",
];

afterEach(() => {
	vi.restoreAllMocks();
	for (const raw of databases.splice(0)) raw.close();
});

function applyAliasMigration(raw: DatabaseSync) {
	raw.exec(readFileSync(`migrations/${migration}`, "utf8"));
}

function rows(raw: DatabaseSync, tables = unchangedTables) {
	return Object.fromEntries(
		tables.map((table) => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
	);
}

async function legacyFixture() {
	const raw = new DatabaseSync(":memory:");
	databases.push(raw);
	raw.exec(
		"PRAGMA foreign_keys = ON; CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO _test_marker VALUES ('env', 'test')",
	);
	for (const file of readdirSync("migrations")
		.filter((file) => file.endsWith(".sql") && file < migration)
		.sort()) {
		raw.exec(readFileSync(`migrations/${file}`, "utf8"));
	}
	const db = sqliteD1(raw);
	const scoped = await mintApiKey(
		db,
		"migration-test-pepper",
		{
			name: "legacy-scoped",
			role: "custom",
			ops: "r,w,u,d",
			scope: "spaces",
			spaceIds: ["legacy-space-id"],
		},
		1000,
	);
	const own = await mintApiKey(
		db,
		"migration-test-pepper",
		{ name: "legacy-room", role: "project", ops: "r,w,u,d", scope: "own", autoOwnSpace: true },
		1000,
	);
	const hidden = await mintApiKey(
		db,
		"migration-test-pepper",
		{
			name: "legacy-hidden",
			role: "custom",
			ops: "r,w,u,d",
			scope: "spaces",
			spaceIds: ["hidden-space-id"],
		},
		1000,
	);
	raw
		.prepare(
			"INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at) VALUES ('legacy-space-id', 'legacy-room', 'Original name', 'Original description', ?, 1000, 1000)",
		)
		.run(own.row.id);
	raw.exec(
		"INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES ('hidden-space-id', 'hidden-room', 'Hidden', 1000, 1000)",
	);
	raw
		.prepare(
			"INSERT INTO memories (id, space_id, title, body, type, source_key_id, version, content_hash, created_at, updated_at) VALUES ('legacy-memory', 'legacy-space-id', 'legacy searchable', 'preserve content', 'note', ?, 1, 'legacy-hash', 1000, 1000)",
		)
		.run(scoped.row.id);
	raw
		.prepare(
			"INSERT INTO memory_versions (memory_id, version, title, body, type, importance, tags_json, space_id, actor, op, created_at) VALUES ('legacy-memory', 1, 'legacy searchable', 'preserve content', 'note', 0.5, '[\"legacy-tag\"]', 'legacy-space-id', ?, 'create', 1000)",
		)
		.run(`key:${scoped.row.id}`);
	raw.exec(`
		INSERT INTO attachments (id, memory_id, r2_key, filename, content_type, size_bytes, sha256, created_by, created_at) VALUES ('legacy-attachment', 'legacy-memory', 'legacy-file', 'legacy.txt', 'text/plain', 4, 'legacy-sha', 'key:fixture', 1000);
		INSERT INTO tags (id, name, display_name, created_at, updated_at) VALUES ('legacy-tag-id', 'legacy-tag', 'legacy-tag', 1000, 1000);
		INSERT INTO memory_tags (memory_id, tag_id, position) VALUES ('legacy-memory', 'legacy-tag-id', 0);
		INSERT INTO memories_fts (rowid, title, body, tags) VALUES (1, 'legacy searchable', 'preserve content', 'legacy-tag');
		INSERT INTO memories_words_fts (rowid, title, body, tags) VALUES (1, 'legacy searchable', 'preserve content', 'legacy-tag');
		INSERT INTO memories_fts_map (memory_id, fts_rowid) VALUES ('legacy-memory', 1);
		INSERT INTO search_tag_tokens (tag_id, name, tokens) VALUES ('legacy-tag-id', 'legacy-tag', 'legacy tag');
		INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES ('memory', 'legacy-memory', 'legacy-space-id', 'created', 1, 'key:fixture', 1000);
		INSERT INTO audit_log (id, at, actor, method, route, status, space_id, entity_id, request_id, duration_ms) VALUES ('legacy-audit', 1000, 'key:fixture', 'POST', '/api/v1/memories', 201, 'legacy-space-id', 'legacy-memory', 'legacy-request', 1);
		INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('embedding.backfill_enabled', 'false', 'admin:fixture', 1000);
		INSERT INTO embedding_profiles (id, model, dims, vectorize_index, active, created_at) VALUES ('legacy-3', 'legacy', 3, 'local-only', 0, 1000);
		INSERT INTO memory_vectors (memory_id, profile_id, embedding_model, dim, vector, content_hash, indexed_at, updated_at) VALUES ('legacy-memory', 'legacy-3', 'legacy', 3, X'0000803f0000000000000000', 'legacy-hash', 1000, 1000);
		UPDATE memory_vectors SET indexed_at = 1000 WHERE memory_id = 'legacy-memory';
	`);
	raw
		.prepare(
			"INSERT INTO idempotency_records (key_id, idem_key, request_hash, status, response_json, created_at) VALUES (?, 'legacy-idem', 'legacy-request-hash', 201, '{}', 1000)",
		)
		.run(scoped.row.id);
	raw
		.prepare(
			"INSERT INTO idempotency_response_chunks (key_id, idem_key, chunk_index, body) VALUES (?, 'legacy-idem', 0, '{}')",
		)
		.run(scoped.row.id);
	const env = { DB: db, API_KEY_PEPPER: "migration-test-pepper", RESOURCE_ENV: "test" } as Env;
	const principal = (token: string) =>
		authenticateBearer(
			new Request("http://local/api/v1/memories/legacy-memory", {
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
		);
	return { raw, db, scoped, own, hidden, env, principal, service: new MemoryService(db) };
}

describe("space slug alias migration", () => {
	it("applies after pre-existing keys, memories and attachments without rewriting ID-based data or permissions", async () => {
		const f = await legacyFixture();
		const before = rows(f.raw);
		const oldPrincipal = await f.principal(f.scoped.plaintext);
		const oldOwn = await f.principal(f.own.plaintext);
		const oldMemory = await f.service.get(
			authzFrom(oldPrincipal),
			"legacy-memory",
			new Set(["attachments", "versions_count"]),
		);
		expect(oldMemory).toMatchObject({
			id: "legacy-memory",
			space: "legacy-room",
			attachments: [expect.objectContaining({ id: "legacy-attachment" })],
		});
		expect(authorize(oldPrincipal, "write", { spaceId: "legacy-space-id" })).toEqual({
			allow: true,
		});
		expect(authorize(oldPrincipal, "read", { spaceId: "hidden-space-id" })).toEqual({
			allow: false,
			reason: "not_found",
		});
		applyAliasMigration(f.raw);
		expect(rows(f.raw)).toEqual(before);
		expect(f.raw.prepare("SELECT * FROM space_slug_aliases").all()).toEqual([]);
		expect(f.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
		const afterPrincipal = await f.principal(f.scoped.plaintext);
		expect(afterPrincipal).toEqual(oldPrincipal);
		expect(await f.principal(f.own.plaintext)).toEqual(oldOwn);
		expect(
			await f.service.get(
				authzFrom(afterPrincipal),
				"legacy-memory",
				new Set(["attachments", "versions_count"]),
			),
		).toEqual(oldMemory);
		const found = await searchMemories(
			searchAuthzFromPrincipal(afterPrincipal),
			{ query: "legacy", mode: "fts", limit: 20 },
			{ db: f.db, env: f.env },
		);
		expect(found.items).toMatchObject([{ id: "legacy-memory", space: "legacy-room" }]);
		const hidden = await f.principal(f.hidden.plaintext);
		await expect(
			f.service.get(authzFrom(hidden), "legacy-memory", new Set()),
		).rejects.toMatchObject({ code: "not_found" });
		expect(
			(
				await searchMemories(
					searchAuthzFromPrincipal(hidden),
					{ query: "legacy", mode: "fts", limit: 20 },
					{ db: f.db, env: f.env },
				)
			).items,
		).toEqual([]);
	});

	it("keeps scoped and owned credentials, attachments and history stable after rename and resyncs slug metadata", async () => {
		const f = await legacyFixture();
		applyAliasMigration(f.raw);
		const stableTables = unchangedTables.filter(
			(table) => !["changes", "memory_vectors", "vector_sync_jobs"].includes(table),
		);
		const before = rows(f.raw, stableTables);
		const job = f.raw
			.prepare("SELECT generation FROM vector_sync_jobs WHERE memory_id = 'legacy-memory'")
			.get() as { generation: number };
		const scoped = await f.principal(f.scoped.plaintext);
		const renamed = await updateManagedSpace(f.db, { ...scoped, role: "admin" }, "legacy-room", {
			slug: "renamed-room",
		});
		expect(renamed).toMatchObject({
			id: "legacy-space-id",
			slug: "renamed-room",
			name: "Original name",
			description: "Original description",
			owner_key_id: f.own.row.id,
		});
		expect(rows(f.raw, stableTables)).toEqual(before);
		expect(
			f.raw
				.prepare(
					"SELECT content_hash, vector, indexed_at FROM memory_vectors WHERE memory_id = 'legacy-memory'",
				)
				.get(),
		).toEqual({
			content_hash: "legacy-hash",
			vector: new Uint8Array(new Float32Array([1, 0, 0]).buffer),
			indexed_at: null,
		});
		const afterJob = f.raw
			.prepare("SELECT generation FROM vector_sync_jobs WHERE memory_id = 'legacy-memory'")
			.get() as { generation: number };
		expect(afterJob.generation).toBeGreaterThan(job.generation);
		for (const token of [f.scoped.plaintext, f.own.plaintext]) {
			const principal = await f.principal(token);
			expect(visibleSpaceIds(principal)).toEqual({ kind: "ids", ids: ["legacy-space-id"] });
			const authz = authzFrom(principal);
			expect(await f.service.get(authz, "legacy-memory", new Set(["attachments"]))).toMatchObject({
				space: "renamed-room",
				attachments: [expect.objectContaining({ id: "legacy-attachment" })],
			});
			for (const slug of ["legacy-room", "renamed-room"]) {
				expect(
					await new SpaceRepo(f.db).getVisibleBySlug(slug, visibleSpaceIds(principal)),
				).toMatchObject({ id: "legacy-space-id", slug: "renamed-room" });
				expect(
					(
						await f.service.list(authz, {
							filters: { spaces: [slug] },
							include: new Set(),
							limit: 20,
						})
					).items,
				).toMatchObject([{ id: "legacy-memory", space: "renamed-room" }]);
				expect(
					(
						await searchMemories(
							searchAuthzFromPrincipal(principal),
							{ query: "legacy", mode: "fts", filters: { spaces: [slug] }, limit: 20 },
							{ db: f.db, env: f.env },
						)
					).items,
				).toMatchObject([{ id: "legacy-memory", space: "renamed-room" }]);
			}
		}
		expect(await ensureAutoOwnSpace(f.db, f.own.row)).toMatchObject({
			id: "legacy-space-id",
			slug: "renamed-room",
		});
		expect(f.raw.prepare("SELECT id FROM spaces WHERE owner_key_id = ?").all(f.own.row.id)).toEqual(
			[{ id: "legacy-space-id" }],
		);
		const hidden = await f.principal(f.hidden.plaintext);
		for (const slug of ["legacy-room", "renamed-room"]) {
			expect(await new SpaceRepo(f.db).getVisibleBySlug(slug, visibleSpaceIds(hidden))).toBeNull();
			await expect(
				f.service.create(authzFrom(hidden), {
					space: slug,
					title: "Denied",
					body: "Denied",
					type: "note",
					tags: [],
					importance: 0.5,
				}),
			).rejects.toMatchObject({ code: "not_found" });
		}
		expect(
			await f.service.create(authzFrom(scoped), {
				space: "legacy-room",
				title: "Allowed",
				body: "Allowed",
				type: "note",
				tags: [],
				importance: 0.5,
			}),
		).toMatchObject({ space: "renamed-room" });
		expect(f.raw.prepare("SELECT space_id FROM memories ORDER BY id").all()).toEqual([
			{ space_id: "legacy-space-id" },
			{ space_id: "legacy-space-id" },
		]);
	});

	it("enforces alias uniqueness and foreign keys, exact expiry boundaries and cascading deletion", async () => {
		const f = await legacyFixture();
		applyAliasMigration(f.raw);
		vi.spyOn(Date, "now").mockReturnValue(2000);
		f.raw.exec(
			"INSERT INTO space_slug_aliases (slug, space_id, created_at, expires_at) VALUES ('old-room', 'legacy-space-id', 1000, 2001)",
		);
		const repo = new SpaceRepo(f.db);
		expect(
			await repo.getVisibleBySlug("old-room", { kind: "ids", ids: ["legacy-space-id"] }),
		).toMatchObject({ id: "legacy-space-id", slug: "legacy-room" });
		expect(
			await repo.getVisibleBySlug("old-room", { kind: "ids", ids: ["hidden-space-id"] }),
		).toBeNull();
		vi.mocked(Date.now).mockReturnValue(2001);
		expect(await repo.getVisibleBySlug("old-room", { kind: "all" })).toBeNull();
		expect(() =>
			f.raw.exec(
				"INSERT INTO space_slug_aliases (slug, space_id, created_at, expires_at) VALUES ('old-room', 'hidden-space-id', 1000, 3000)",
			),
		).toThrow(/UNIQUE/);
		expect(() =>
			f.raw.exec(
				"INSERT INTO space_slug_aliases (slug, space_id, created_at, expires_at) VALUES ('orphan', 'missing-space-id', 1000, 3000)",
			),
		).toThrow(/FOREIGN KEY/);
		f.raw.exec(
			"INSERT INTO space_slug_aliases (slug, space_id, created_at, expires_at) VALUES ('hidden-alias', 'hidden-space-id', 1000, 3000); DELETE FROM spaces WHERE id = 'hidden-space-id'",
		);
		expect(f.raw.prepare("SELECT slug FROM space_slug_aliases ORDER BY slug").all()).toEqual([
			{ slug: "old-room" },
		]);
	});
});
