import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	b64url,
	b64urlDecode,
	generateJwksPair,
	L2_ACCESS_AUD,
	l2AccessIss,
	l2JwksUrl,
	loadJwksState,
	signAccessJwt,
	startJwksStub,
	tamperJwtSignature,
} from "./jwks-stub";
import { L2_JWKS_PORT } from "./ports";

function get(url: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		httpGet(url, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk) => {
				chunks.push(chunk as Buffer);
			});
			res.on("end", () => {
				resolve({
					status: res.statusCode ?? 0,
					body: Buffer.concat(chunks).toString("utf8"),
				});
			});
		}).on("error", reject);
	});
}

describe("jwks stub", () => {
	it("serves JWKS and signs RS256 tokens", async () => {
		expect(L2_ACCESS_AUD).toBe("octo-e2e");
		expect(l2AccessIss()).toBe(`http://127.0.0.1:${L2_JWKS_PORT}`);
		expect(l2JwksUrl(9)).toBe("http://127.0.0.1:9/cdn-cgi/access/certs");
		expect(b64url(new Uint8Array([251, 255]))).toContain("-");
		const state = await generateJwksPair("k-e2e");
		expect(state.kid).toBe("k-e2e");
		expect(state.publicJwk.kid).toBe("k-e2e");
		const token = await signAccessJwt(state, { email: "a@b.c", aud: L2_ACCESS_AUD });
		expect(token.split(".")).toHaveLength(3);
		const tampered = tamperJwtSignature(token);
		const origSig = token.split(".")[2] ?? "";
		const badSig = tampered.split(".")[2] ?? "";
		expect(b64urlDecode(badSig)).not.toEqual(b64urlDecode(origSig));
		expect(tampered.startsWith(`${token.split(".").slice(0, 2).join(".")}.`)).toBe(true);
		expect(() => tamperJwtSignature("nope")).toThrow("three parts");
		expect(() => tamperJwtSignature("a.b.")).toThrow("empty signature");
		const dir = await mkdtemp(join(tmpdir(), "octo-jwks-"));
		const path = join(dir, "state.json");
		await writeFile(path, JSON.stringify(state));
		const loaded = await loadJwksState(path);
		expect(loaded.kid).toBe("k-e2e");
		await expect(loadJwksState(undefined)).rejects.toThrow("OCTO_JWKS_STATE");
		const holder = createServer();
		await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", () => resolve()));
		const addr = holder.address();
		if (!addr || typeof addr === "string") {
			holder.close();
			throw new Error("no port");
		}
		const occupied = addr.port;
		await expect(startJwksStub(occupied, state)).rejects.toThrow("already in use");
		await new Promise<void>((resolve) => holder.close(() => resolve()));
		const stub = await startJwksStub(occupied, state);
		try {
			const jwks = await get(stub.url);
			expect(jwks.status).toBe(200);
			const body = JSON.parse(jwks.body) as { keys: Array<{ kid?: string }> };
			expect(body.keys[0]?.kid).toBe("k-e2e");
			const missing = await get(`http://127.0.0.1:${occupied}/nope`);
			expect(missing.status).toBe(404);
			const otherKid = await signAccessJwt(state, { email: "a@b.c" }, "missing");
			const headerPart = otherKid.split(".")[0] ?? "";
			const padded =
				headerPart.replace(/-/g, "+").replace(/_/g, "/") +
				"=".repeat((4 - (headerPart.length % 4)) % 4);
			expect(JSON.parse(atob(padded))).toMatchObject({ kid: "missing" });
		} finally {
			await stub.close();
		}
		await expect(startJwksStub(-1, state)).rejects.toBeTruthy();
	});
});
