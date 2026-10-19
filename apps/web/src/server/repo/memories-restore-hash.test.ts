import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture } from "../settings/__tests__/fixture";
import { backfillMemory } from "../settings/backfill";
import { runDerivedTasks } from "../sync/tasks";
import { contentHash, MemoryRepo, type MemoryWrite } from "./memories";

const databases: ReturnType<typeof fixture>["raw"][] = [];
afterEach(() => {
	vi.unstubAllGlobals();
	for (const db of databases.splice(0)) db.close();
});

const input: MemoryWrite = {
	id: "memory",
	spaceId: "space",
	spaceSlug: "space",
	title: "Legacy client vector",
	body: "Preserve the embedding without a model call",
	type: "note",
	importance: 0.5,
	eventTime: null,
	tags: [],
	actor: "client",
	sourceKeyId: "client",
	updatedByKeyId: "client",
	op: "create",
	now: 1,
};

describe.each(["direct", "staged"] as const)("%s legacy-hash restore", (mode) => {
	it.each([false, true])(
		"canonicalizes the memory without blessing a stale vector: %s",
		async (stale) => {
			const { raw, env } = fixture();
			databases.push(raw);
			raw.exec("INSERT INTO spaces VALUES ('space', 'space', 'Space', '', NULL, 1, 1)");
			const fetcher = vi.fn(() => {
				throw new Error("restore must not call the embedding gateway");
			});
			vi.stubGlobal("fetch", fetcher);
			const repo = new MemoryRepo(env.DB);
			await repo.write({
				...input,
				vector: {
					profileId: "tiny",
					embeddingModel: "tiny",
					dim: 3,
					vector: new Float32Array([1, 0, 0]).buffer,
				},
			});
			const legacyHash = createHash("sha256")
				.update(input.title + input.body)
				.digest("hex");
			const canonicalHash = await contentHash(input.title, input.body);
			expect(legacyHash).not.toBe(canonicalHash);
			const vectorHash = stale
				? createHash("sha256").update("earlier title and body").digest("hex")
				: legacyHash;
			raw.prepare("UPDATE memories SET content_hash = ? WHERE id = ?").run(legacyHash, input.id);
			raw
				.prepare("UPDATE memory_vectors SET content_hash = ?, indexed_at = 1 WHERE memory_id = ?")
				.run(vectorHash, input.id);
			const [before] = await repo.vectorsByMemory(input.id);
			const trashed = await repo.trash(input.id, input.actor, 2, { version: 1, spaceId: "space" });
			const statements: D1PreparedStatement[] = [];
			const writer =
				mode === "staged" ? new MemoryRepo(env.DB, (pending) => statements.push(...pending)) : repo;
			const restored = await writer.write({
				...input,
				op: "restore",
				previous: trashed,
				expectedVersion: 1,
				now: 3,
			});
			if (mode === "staged") await env.DB.batch(statements);
			expect(await repo.get(input.id)).toMatchObject({
				version: 2,
				content_hash: canonicalHash,
				deleted_at: null,
				deleted_by: null,
			});
			expect(restored.content_hash).toBe(canonicalHash);
			const [after] = await repo.vectorsByMemory(input.id);
			expect(after).toEqual({ ...before, content_hash: stale ? vectorHash : canonicalHash });
			expect(await repo.vectorStatus(input.id, canonicalHash)).toEqual([
				{ profile: "tiny", indexed: false, stale },
			]);
			expect(raw.prepare("SELECT version, op FROM memory_versions ORDER BY version").all()).toEqual(
				[
					{ version: 1, op: "create" },
					{ version: 2, op: "restore" },
				],
			);
			expect(await backfillMemory(env, input.id)).toBe(false);
			expect(await runDerivedTasks(env, 4, [input.id])).toEqual({ synced: 1, failed: 0 });
			expect(await repo.vectorStatus(input.id, canonicalHash)).toEqual([
				{ profile: "tiny", indexed: !stale, stale },
			]);
			expect(fetcher).not.toHaveBeenCalled();
			expect(raw.prepare("SELECT COUNT(*) AS n FROM memory_embedding_calls").get()).toEqual({
				n: 0,
			});
		},
	);
});
