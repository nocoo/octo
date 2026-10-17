/// <reference types="@cloudflare/workers-types" />
import { generateApiKeyMaterial, hashSecret } from "../apps/web/src/server/auth/api-key";
import type { AsyncD1Exec, D1Exec } from "./local-d1";

export async function seedAttachmentKey(
	d1: D1Exec | AsyncD1Exec,
	{ ops = "r,w,u,d", scope = "all", ownOnly = false } = {},
) {
	const material = generateApiKeyMaterial();
	const secretHash = await hashSecret("change-me-api-key-pepper", material.secret);
	const now = Date.now();
	await d1([
		"--command",
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, created_at, updated_at)
		VALUES ('${material.keyid}', 'e2e-att-${material.keyid}', '${secretHash}', 'admin', '${ops}', '${scope}', '["spacee2e02"]', ${ownOnly ? 1 : 0}, 0, ${now}, ${now})`,
	]);
	return { header: `Bearer ${material.plaintext}`, keyId: material.keyid };
}
