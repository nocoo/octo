import { describe, expect, it } from "vitest";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { L2_JWKS_PORT } from "../../scripts/ports";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17058";
const jwksPort = Number(process.env.OCTO_JWKS_PORT ?? L2_JWKS_PORT);

describe("author profile runtime fetch", () => {
	it("loads name and avatar through workerd fetch without AUTHOR_PROFILE_FETCHER", async () => {
		const jwt = await signAccessJwt(await loadJwksState(), {
			iss: l2AccessIss(jwksPort),
			aud: L2_ACCESS_AUD,
			exp: Math.floor(Date.now() / 1000) + 3600,
			email: "architie@gmail.com",
		});
		const response = await fetch(`${base}/api/admin/whoami`, {
			headers: { "Cf-Access-Jwt-Assertion": jwt },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			email: "architie@gmail.com",
			actor: "admin:architie@gmail.com",
			name: "Zheng Li",
			avatar: expect.stringMatching(/^data:image\/png;base64,/),
		});
	});
});
