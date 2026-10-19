import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { contentHash } from "../repo/memories";
import { TagRepo } from "../repo/tags";
import { fixture } from "../settings/__tests__/fixture";
import { testApiPrincipal } from "../test-principal";
import { BatchMemoryService, type MemoryServiceContext } from "./batch-memories";
import { authzFrom, MemoryService } from "./memories";

const databases: ReturnType<typeof fixture>["raw"][] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});

const input = {
	space: "space",
	title: "Legacy batch vector",
	body: "The normalized client vector must remain current",
	type: "note" as const,
	tags: ["existing"],
	vector: { profile: "tiny", values: [0, 3, 4] },
};
const identicalVector = { profile: "tiny", values: [0, 6, 8] };
const updatedTags = ["existing", "added"];

async function setup(stale = false) {
	const { raw, env } = fixture();
	databases.push(raw);
	raw.exec("INSERT INTO spaces VALUES ('space', 'space', 'Space', '', NULL, 1, 1)");
	const principal = testApiPrincipal("client");
	const created = await new MemoryService(env.DB).create(authzFrom(principal), input);
	const id = String(created.id);
	await new TagRepo(env.DB).resolveMany(updatedTags);
	const legacyHash = createHash("sha256")
		.update(input.title + input.body)
		.digest("hex");
	const vectorHash = stale
		? createHash("sha256").update("earlier title and body").digest("hex")
		: legacyHash;
	raw.prepare("UPDATE memories SET content_hash = ? WHERE id = ?").run(legacyHash, id);
	raw
		.prepare("UPDATE memory_vectors SET content_hash = ?, indexed_at = 1 WHERE memory_id = ?")
		.run(vectorHash, id);
	const batch = new BatchMemoryService();
	const ctx: MemoryServiceContext = {
		db: env.DB,
		principal,
		statements: [],
		vectorMemoryIds: [],
	};
	return { raw, env, id, batch, ctx, legacyHash, vectorHash };
}

describe("batch staged legacy-hash vector provenance", () => {
	it("keeps an identical vector PUT at version 2 after tag-only canonicalization", async () => {
		const { raw, env, id, batch, ctx, legacyHash } = await setup();
		const updated = await batch.update(id, { tags: updatedTags, expected_version: 1 }, ctx);
		expect(updated.version).toBe(2);
		const statementCount = ctx.statements.length;
		expect(statementCount).toBeGreaterThan(0);
		expect(
			raw.prepare("SELECT content_hash FROM memory_vectors WHERE memory_id = ?").get(id),
		).toEqual({
			content_hash: legacyHash,
		});
		const repeated = await batch.update(id, { vector: identicalVector, expected_version: 2 }, ctx);
		expect(repeated).toEqual(updated);
		expect(ctx.statements).toHaveLength(statementCount);
		expect(ctx.vectorMemoryIds).toEqual([id]);
		await env.DB.batch(ctx.statements);
		const canonicalHash = await contentHash(input.title, input.body);
		expect(raw.prepare("SELECT version, content_hash FROM memories WHERE id = ?").get(id)).toEqual({
			version: 2,
			content_hash: canonicalHash,
		});
		expect(
			raw.prepare("SELECT content_hash FROM memory_vectors WHERE memory_id = ?").get(id),
		).toEqual({
			content_hash: canonicalHash,
		});
		expect(
			raw.prepare("SELECT COUNT(*) AS n FROM memory_versions WHERE memory_id = ?").get(id),
		).toEqual({ n: 2 });
		expect(raw.prepare("SELECT COUNT(*) AS n FROM changes WHERE entity_id = ?").get(id)).toEqual({
			n: 2,
		});
	});

	it("does not bless a stale vector before an explicit replacement PUT", async () => {
		const { raw, env, id, batch, ctx, vectorHash } = await setup(true);
		expect((await batch.update(id, { tags: updatedTags, expected_version: 1 }, ctx)).version).toBe(
			2,
		);
		const statementCount = ctx.statements.length;
		expect(
			raw.prepare("SELECT content_hash FROM memory_vectors WHERE memory_id = ?").get(id),
		).toEqual({
			content_hash: vectorHash,
		});
		expect(
			(await batch.update(id, { vector: identicalVector, expected_version: 2 }, ctx)).version,
		).toBe(3);
		expect(ctx.statements.length).toBeGreaterThan(statementCount);
		await env.DB.batch(ctx.statements);
		expect(
			raw.prepare("SELECT content_hash FROM memory_vectors WHERE memory_id = ?").get(id),
		).toEqual({
			content_hash: await contentHash(input.title, input.body),
		});
	});

	it("restores cached legacy vector hashes when rolling back a canonicalizing write", async () => {
		const { id, batch, ctx } = await setup();
		expect(
			(await batch.update(id, { vector: identicalVector, expected_version: 1 }, ctx)).version,
		).toBe(1);
		expect(ctx.statements).toEqual([]);
		const rollback = batch.checkpoint(ctx);
		expect((await batch.update(id, { tags: updatedTags, expected_version: 1 }, ctx)).version).toBe(
			2,
		);
		expect(ctx.statements.length).toBeGreaterThan(0);
		rollback();
		expect(ctx.statements).toEqual([]);
		expect(ctx.vectorMemoryIds).toEqual([]);
		expect(
			(await batch.update(id, { vector: identicalVector, expected_version: 1 }, ctx)).version,
		).toBe(1);
		expect(ctx.statements).toEqual([]);
	});
});
