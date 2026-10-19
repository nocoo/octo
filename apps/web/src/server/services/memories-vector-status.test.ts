import { expect, it } from "vitest";
import { parseOps } from "../auth/authorize";
import { fixture, SETTINGS } from "../settings/__tests__/fixture";
import { saveEmbeddingSettings } from "../settings/config";
import { authzFrom, MemoryService } from "./memories";

it("exposes per-profile embedding attempts even before a vector exists, without changing source identity", async () => {
	const { env, raw } = fixture();
	raw.exec("INSERT INTO spaces VALUES ('s', 's', 's', '', NULL, 1, 1)");
	raw.exec(
		"INSERT INTO memories (id, space_id, title, body, type, source_key_id, content_hash, created_at, updated_at) VALUES ('m', 's', 'Title', 'Body', 'note', 'source-client', 'hash', 1, 1)",
	);
	await saveEmbeddingSettings(env, SETTINGS, "admin:local");
	const authz = authzFrom({
		id: "k",
		name: "k",
		role: "custom",
		ops: parseOps("r"),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: [],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
	});
	const service = new MemoryService(env.DB);
	expect(await service.get(authz, "m", new Set(["vector_status"]))).toMatchObject({
		source_key_id: "source-client",
		vector_status: [{ profile: "tiny", indexed: false, stale: false, embedding_calls: 0 }],
	});
	raw.exec("INSERT INTO memory_embedding_calls VALUES ('m', 'tiny', 2)");
	expect(await service.get(authz, "m", new Set(["vector_status"]))).toMatchObject({
		vector_status: [{ profile: "tiny", indexed: false, stale: false, embedding_calls: 2 }],
	});
	raw.exec(
		"INSERT INTO memory_vectors VALUES ('m', 'tiny', 'tiny', 3, x'0000803f0000000000000000', 'hash', NULL, 1)",
	);
	expect(await service.get(authz, "m", new Set(["vector_status"]))).toMatchObject({
		vector_status: [{ profile: "tiny", indexed: false, stale: false, embedding_calls: 2 }],
	});
	expect(await service.get(authz, "m", new Set())).not.toHaveProperty("vector_status");
});
