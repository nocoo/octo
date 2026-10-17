import { seedAttachmentKey } from "../../scripts/attachment-fixtures";
import type { AsyncD1Exec } from "../../scripts/local-d1";
import { e2eD1 } from "./l2-batch";

let ownedD1: AsyncD1Exec | undefined;

async function reset(d1: AsyncD1Exec) {
	// The NOT NULL guard rejects foreign or missing markers before any cleanup in this command.
	await d1([
		"--command",
		`INSERT INTO _test_marker (key, value)
		SELECT 'env', NULL WHERE NOT EXISTS (SELECT 1 FROM _test_marker WHERE key = 'env' AND value = 'test');
		DELETE FROM changes WHERE entity = 'attachment' AND entity_id IN
			(SELECT id FROM attachments WHERE memory_id = 'meme2e000001');
		DELETE FROM attachments WHERE memory_id = 'meme2e000001';
		DELETE FROM memories WHERE id = 'meme2e000001';
		DELETE FROM spaces WHERE id IN ('spacee2e01', 'spacee2e02');
		DELETE FROM idempotency_response_chunks WHERE key_id IN (SELECT id FROM api_keys WHERE name LIKE 'e2e-att%');
		DELETE FROM idempotency_records WHERE key_id IN (SELECT id FROM api_keys WHERE name LIKE 'e2e-att%');
		DELETE FROM api_keys WHERE name LIKE 'e2e-att%';`,
	]);
}

export async function setupAttachmentFixtures() {
	const d1 = await e2eD1();
	ownedD1 = d1;
	await reset(d1);
	const key = await seedAttachmentKey(d1);
	const now = Date.now();
	await d1([
		"--command",
		`INSERT INTO spaces (id, slug, name, description, owner_key_id, created_at, updated_at)
		VALUES ('spacee2e01', 'e2e-space', 'E2E', '', '${key.keyId}', ${now}, ${now});
		INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, version, content_hash, created_at, updated_at)
		VALUES ('meme2e000001', 'spacee2e01', 't', 'b', 'note', 0.5, '${key.keyId}', 1, 'hash', ${now}, ${now});`,
	]);
	return { d1, ...key };
}

export async function cleanupAttachmentFixtures() {
	if (!ownedD1) return;
	await reset(ownedD1);
	ownedD1 = undefined;
}
