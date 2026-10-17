import { describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const jwksPort = Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT);

async function whoami(jwt?: string): Promise<Response> {
	const headers: Record<string, string> = {};
	if (jwt) {
		headers["Cf-Access-Jwt-Assertion"] = jwt;
	}
	return fetch(`${base}/api/admin/whoami`, { headers });
}

describe("GET /api/admin/whoami", () => {
	it("accepts a valid Access JWT and rejects bad claims", async () => {
		const state = await loadJwksState();
		const iss = l2AccessIss(jwksPort);
		const now = Math.floor(Date.now() / 1000);
		const valid = await signAccessJwt(state, {
			iss,
			aud: L2_ACCESS_AUD,
			exp: now + 3600,
			email: "e2e@local",
		});
		const ok = await whoami(valid);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ email: "e2e@local", actor: "admin:e2e@local" });
		const wrongAud = await signAccessJwt(state, {
			iss,
			aud: "wrong",
			exp: now + 3600,
			email: "e2e@local",
		});
		const wrongIss = await signAccessJwt(state, {
			iss: "https://evil.example",
			aud: L2_ACCESS_AUD,
			exp: now + 3600,
			email: "e2e@local",
		});
		const expired = await signAccessJwt(state, {
			iss,
			aud: L2_ACCESS_AUD,
			exp: now - 120,
			email: "e2e@local",
		});
		const unknownKid = await signAccessJwt(
			state,
			{ iss, aud: L2_ACCESS_AUD, exp: now + 3600, email: "e2e@local" },
			"missing",
		);
		for (const jwt of [wrongAud, wrongIss, expired, unknownKid, undefined]) {
			const res = await whoami(jwt);
			expect(res.status).toBe(401);
			expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
		}
	});
});
