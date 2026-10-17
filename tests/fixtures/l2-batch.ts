import { afterAll } from "vitest";
import { generateApiKeyMaterial, hashSecret } from "../../apps/web/src/server/auth/api-key";
import { type FixtureD1Session, openFixtureD1 } from "../../scripts/fixture-d1";
import { type AsyncD1Exec, assertAsyncTestMarker } from "../../scripts/local-d1";

export const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
export const input = { space: "kb", title: "title", body: "body", type: "note", tags: [] };
export type BatchBody = {
	results: Array<{
		ok: boolean;
		item?: { id: string; title: string; body: string; version: number; trashed_at?: string };
		error?: { code: string };
	}>;
};
let session: { persist: string; config: string; opened: Promise<FixtureD1Session> } | undefined;

export async function disposeE2eD1(): Promise<void> {
	const active = session;
	session = undefined;
	if (active)
		await active.opened.then(
			(runtime) => runtime.dispose(),
			() => {},
		);
}

afterAll(disposeE2eD1);

export async function e2eD1(): Promise<AsyncD1Exec> {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (!persist || !config) throw new Error("OCTO_PERSIST and OCTO_CONFIG are required");
	if (session && (session.persist !== persist || session.config !== config)) {
		throw new Error("fixture D1 cannot change isolated runs before disposal");
	}
	session ??= { persist, config, opened: openFixtureD1(persist, config) };
	const runtime = await session.opened;
	await assertAsyncTestMarker(runtime.exec);
	return runtime.exec;
}
export function sqlText(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}
export async function query<T>(d1: AsyncD1Exec, sql: string): Promise<T[]> {
	const output = await d1(["--command", sql, "--json"]);
	const parsed = JSON.parse(output.slice(output.indexOf("["))) as Array<{ results: T[] }>;
	return parsed[0]?.results ?? [];
}
export async function seedKey(
	d1: AsyncD1Exec,
	options: {
		ops?: string;
		scope?: "all" | "own" | "spaces";
		spaceIds?: string[];
		ownEntriesOnly?: boolean;
	} = {},
) {
	const material = generateApiKeyMaterial();
	const hash = await hashSecret("change-me-api-key-pepper", material.secret);
	const now = Date.now();
	await d1([
		"--command",
		`INSERT INTO api_keys (id, name, secret_hash, role, ops, scope, space_ids_json, own_entries_only, auto_own_space, created_at, updated_at) VALUES (${sqlText(material.keyid)}, ${sqlText(`e2e-${material.keyid}`)}, ${sqlText(hash)}, 'admin', ${sqlText(options.ops ?? "r,w,u,d")}, ${sqlText(options.scope ?? "all")}, ${sqlText(JSON.stringify(options.spaceIds ?? []))}, ${options.ownEntriesOnly ? 1 : 0}, 0, ${now}, ${now})`,
	]);
	return { id: material.keyid, token: material.plaintext };
}
export function post(
	action: string,
	token: string | null,
	body: unknown,
	idemKey?: string,
): Promise<Response> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token !== null) headers.Authorization = `Bearer ${token}`;
	if (idemKey !== undefined) headers["Idempotency-Key"] = idemKey;
	return fetch(`${base}/api/v1/memories:batch${action}`, {
		method: "POST",
		headers,
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}
export async function stored(d1: AsyncD1Exec, id: string) {
	return (
		await query<{
			id: string;
			title: string;
			body: string;
			version: number;
			space: string;
			space_id: string;
			deleted_at: number | null;
		}>(
			d1,
			`SELECT m.*, s.slug AS space FROM memories m INNER JOIN spaces s ON s.id = m.space_id WHERE m.id = ${sqlText(id)}`,
		)
	)[0];
}
export async function effectCount(d1: AsyncD1Exec, keyId: string): Promise<number> {
	return (
		(
			await query<{ n: number }>(
				d1,
				`SELECT count(*) AS n FROM memories WHERE source_key_id = ${sqlText(keyId)}`,
			)
		)[0]?.n ?? 0
	);
}
export async function createMemory(token: string, fields: Partial<typeof input> = {}) {
	const res = await post("Create", token, { items: [{ ...input, ...fields }] });
	if (res.status !== 200) throw new Error(`create failed: HTTP ${res.status}`);
	const body = (await res.json()) as BatchBody;
	const item = body.results[0]?.item;
	if (!body.results[0]?.ok || !item) throw new Error(`create failed: ${JSON.stringify(body)}`);
	return item;
}
export async function seedSpace(d1: AsyncD1Exec, ownerKeyId: string | null = null) {
	const id = crypto.randomUUID();
	const slug = `m6-${crypto.randomUUID()}`;
	await d1([
		"--command",
		`INSERT INTO spaces (id, slug, name, owner_key_id, created_at, updated_at) VALUES (${sqlText(id)}, ${sqlText(slug)}, ${sqlText(slug)}, ${ownerKeyId === null ? "NULL" : sqlText(ownerKeyId)}, 0, 0)`,
	]);
	return { id, slug };
}
