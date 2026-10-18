import { beforeAll, describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";
import { base, e2eD1, query, seedKey, seedSpace, sqlText } from "../fixtures/l2-batch";

let key: Awaited<ReturnType<typeof seedKey>>;
let jwt: string;

beforeAll(async () => {
	key = await seedKey(await e2eD1(), { ops: "u" });
	jwt = await signAccessJwt(await loadJwksState(), {
		iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT)),
		aud: L2_ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "tag-delete@local",
	});
});

async function seedTag() {
	const name = `td-${crypto.randomUUID()}`;
	const d1 = await e2eD1();
	await d1([
		"--command",
		`INSERT INTO tags (id,name,display_name,created_at,updated_at) VALUES (${sqlText(name)},${sqlText(name)},${sqlText(name)},1,1)`,
	]);
	return name;
}

function remove(name: string, token: string | null = key.token, idem?: string) {
	return fetch(`${base}/api/v1/tags/${encodeURIComponent(name)}`, {
		method: "DELETE",
		headers: {
			...(token === null ? {} : { Authorization: `Bearer ${token}` }),
			...(idem === undefined ? {} : { "Idempotency-Key": idem }),
		},
	});
}

describe("explicit unused tag deletion over workerd HTTP", () => {
	it("requires all-space update, not delete/read/write or a scoped update key", async () => {
		const name = await seedTag();
		const d1 = await e2eD1();
		for (const scope of ["all", "spaces", "own"] as const) {
			for (const ops of ["", "r", "w", "d", "r,w,d", "u"]) {
				if (scope === "all" && ops === "u") continue;
				const deniedKey = await seedKey(d1, { scope, ops });
				const response = await remove(name, deniedKey.token);
				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
			}
		}
		for (const token of [null, "invalid"]) expect((await remove(name, token)).status).toBe(401);
		for (const field of ["revoked_at", "expires_at"]) {
			const invalidKey = await seedKey(d1, { ops: "u" });
			await d1(["--command", `UPDATE api_keys SET ${field}=1 WHERE id=${sqlText(invalidKey.id)}`]);
			expect((await remove(name, invalidKey.token)).status).toBe(401);
		}
		expect((await remove(name)).status).toBe(200);
	});

	it("normalizes names, commits once, reauthorizes replay and audits only the template", async () => {
		const name = await seedTag();
		const d1 = await e2eD1();
		const actor = await seedKey(d1, { ops: "u" });
		const raw = `  ${name.toUpperCase().replaceAll("T", "Ｔ")}  `;
		const idem = crypto.randomUUID();
		const first = await remove(raw, actor.token, idem);
		expect(first.status).toBe(200);
		const body = await first.text();
		expect(JSON.parse(body)).toEqual({ name, deleted: true });
		for (const [scope, ops] of [
			["all", "d"],
			["spaces", "u"],
			["own", "u"],
		]) {
			await d1([
				"--command",
				`UPDATE api_keys SET scope=${sqlText(scope ?? "")},ops=${sqlText(ops ?? "")} WHERE id=${sqlText(actor.id)}`,
			]);
			const denied = await remove(raw, actor.token, idem);
			expect(denied.status).toBe(403);
			expect(denied.headers.get("Idempotent-Replayed")).toBeNull();
		}
		await d1([
			"--command",
			`UPDATE api_keys SET scope='all',ops='u' WHERE id=${sqlText(actor.id)}`,
		]);
		const replay = await remove(raw, actor.token, idem);
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(body);
		const missing = await remove(name, actor.token);
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
		expect((await remove(" ")).status).toBe(400);
		expect(await query(d1, `SELECT id FROM tags WHERE name=${sqlText(name)}`)).toEqual([]);
		const audits = await query<{ route: string; status: number; error_code: string | null }>(
			d1,
			`SELECT route,status,error_code FROM audit_log WHERE actor=${sqlText(`key:${actor.id}`)}`,
		);
		expect(audits).toHaveLength(6);
		expect(audits.every((audit) => audit.route === "/api/v1/tags/:name")).toBe(true);
		expect(
			audits.filter((audit) => audit.status === 200 && audit.error_code === null),
		).toHaveLength(2);
		expect(
			audits.filter((audit) => audit.status === 403 && audit.error_code === "forbidden"),
		).toHaveLength(3);
		expect(audits).toContainEqual({
			route: "/api/v1/tags/:name",
			status: 404,
			error_code: "not_found",
		});
	});

	it.each([null, 2])(
		"checks all memory references including trash deleted_at=%s",
		async (deletedAt) => {
			const name = await seedTag();
			const d1 = await e2eD1();
			const space = await seedSpace(d1);
			const memory = crypto.randomUUID();
			await d1([
				"--command",
				`INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at,deleted_at) VALUES (${sqlText(memory)},${sqlText(space.id)},'t','b','note','other','h',1,1,${deletedAt ?? "NULL"}); INSERT INTO memory_tags (memory_id,tag_id) VALUES (${sqlText(memory)},${sqlText(name)})`,
			]);
			const idem = crypto.randomUUID();
			for (let i = 0; i < 2; i++) {
				const response = await remove(name, key.token, idem);
				expect(response.status).toBe(409);
				expect(await response.json()).toMatchObject({ error: { code: "tag_in_use" } });
				if (i === 1) expect(response.headers.get("Idempotent-Replayed")).toBe("true");
			}
			expect(
				await query(d1, `SELECT tag_id FROM memory_tags WHERE memory_id=${sqlText(memory)}`),
			).toEqual([{ tag_id: name }]);
			const audits = await query(
				d1,
				`SELECT method,route,status,error_code FROM audit_log WHERE actor=${sqlText(`key:${key.id}`)} AND request_id IN (SELECT request_id FROM audit_log WHERE actor=${sqlText(`key:${key.id}`)} AND error_code='tag_in_use')`,
			);
			expect(audits).toContainEqual({
				method: "DELETE",
				route: "/api/v1/tags/:name",
				status: 409,
				error_code: "tag_in_use",
			});
		},
	);

	it("protects alias targets and removes only the named alias from the leaves inward", async () => {
		const target = await seedTag();
		const alias = await seedTag();
		const leaf = await seedTag();
		const d1 = await e2eD1();
		await d1([
			"--command",
			`UPDATE tags SET merged_into=${sqlText(target)} WHERE id=${sqlText(alias)}; UPDATE tags SET merged_into=${sqlText(alias)} WHERE id=${sqlText(leaf)}`,
		]);
		for (const name of [target, alias]) {
			const response = await remove(name);
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({ error: { code: "tag_in_use" } });
		}
		for (const name of [leaf, alias]) {
			const response = await remove(name);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ name, deleted: true });
			expect(await query(d1, `SELECT id FROM tags WHERE id=${sqlText(target)}`)).toEqual([
				{ id: target },
			]);
		}
		expect((await remove(target)).status).toBe(200);
		expect(await query(d1, "PRAGMA foreign_key_check")).toEqual([]);
	});

	it("rolls back the deletion if saving the idempotent response fails", async () => {
		const name = await seedTag();
		const d1 = await e2eD1();
		const actor = await seedKey(d1, { ops: "u" });
		const trigger = `fail_tag_delete_${crypto.randomUUID().replaceAll("-", "")}`;
		await d1([
			"--command",
			`CREATE TRIGGER ${trigger} BEFORE INSERT ON idempotency_response_chunks WHEN NEW.key_id=${sqlText(actor.id)} BEGIN SELECT RAISE(ABORT,'private-tag-delete-storage'); END`,
		]);
		const idem = crypto.randomUUID();
		try {
			const response = await remove(name, actor.token, idem);
			expect(response.status).toBe(503);
			const body = await response.text();
			expect(JSON.parse(body)).toMatchObject({ error: { code: "unavailable" } });
			expect(body).not.toContain("private-tag-delete-storage");
			expect(await query(d1, `SELECT id FROM tags WHERE id=${sqlText(name)}`)).toEqual([
				{ id: name },
			]);
			expect(
				await query(d1, `SELECT * FROM idempotency_records WHERE key_id=${sqlText(actor.id)}`),
			).toEqual([]);
		} finally {
			await d1(["--command", `DROP TRIGGER ${trigger}`]);
		}
		expect((await remove(name, actor.token, idem)).status).toBe(200);
	});

	it("offers Access-only same-origin admin parity and replays with the admin actor", async () => {
		const name = await seedTag();
		const url = `${base}/api/admin/tags/${encodeURIComponent(name)}`;
		expect(
			(await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${key.token}` } }))
				.status,
		).toBe(401);
		const headers = {
			"Cf-Access-Jwt-Assertion": jwt,
			Origin: "https://octo.hexly.ai",
			"Idempotency-Key": crypto.randomUUID(),
		};
		expect(
			(
				await fetch(url, {
					method: "DELETE",
					headers: { ...headers, Origin: "https://evil.example" },
				})
			).status,
		).toBe(403);
		for (let i = 0; i < 2; i++) {
			const response = await fetch(url, { method: "DELETE", headers });
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ name, deleted: true });
			if (i === 1) expect(response.headers.get("Idempotent-Replayed")).toBe("true");
		}
		const d1 = await e2eD1();
		expect(
			await query(
				d1,
				"SELECT method,route,status,error_code FROM audit_log WHERE actor='admin:tag-delete@local' AND status=200",
			),
		).toEqual(
			Array(2).fill({
				method: "DELETE",
				route: "/api/admin/tags/:name",
				status: 200,
				error_code: null,
			}),
		);
	});
});
