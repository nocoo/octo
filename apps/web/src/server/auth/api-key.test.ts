import { describe, expect, it } from "vitest";
import {
	encodeBase32,
	generateApiKeyMaterial,
	hashSecret,
	KEYID_LENGTH,
	parseApiKey,
	SECRET_LENGTH,
	secretsMatch,
	timingSafeEqual,
} from "./api-key";

describe("encodeBase32", () => {
	it("encodes RFC 4648 vectors without padding", () => {
		const enc = (s: string) => encodeBase32(new TextEncoder().encode(s));
		expect(enc("")).toBe("");
		expect(enc("f")).toBe("MY");
		expect(enc("fo")).toBe("MZXQ");
		expect(enc("foo")).toBe("MZXW6");
		expect(enc("foob")).toBe("MZXW6YQ");
		expect(enc("fooba")).toBe("MZXW6YTB");
		expect(enc("foobar")).toBe("MZXW6YTBOI");
	});
});

describe("generateApiKeyMaterial", () => {
	it("mints octo_<keyid>_<secret> with base32 lengths", () => {
		const material = generateApiKeyMaterial();
		expect(material.keyid).toMatch(/^[A-Z2-7]{12}$/);
		expect(material.secret).toMatch(/^[A-Z2-7]{52}$/);
		expect(material.plaintext).toBe(`octo_${material.keyid}_${material.secret}`);
		expect(material.keyid).toHaveLength(KEYID_LENGTH);
		expect(material.secret).toHaveLength(SECRET_LENGTH);
		const other = generateApiKeyMaterial();
		expect(other.plaintext).not.toBe(material.plaintext);
	});
});

describe("parseApiKey", () => {
	it("parses generated keys and uppercases the secret", () => {
		const material = generateApiKeyMaterial();
		expect(parseApiKey(material.plaintext)).toEqual({
			keyid: material.keyid,
			secret: material.secret,
		});
		const lower = `octo_${material.keyid.toLowerCase()}_${material.secret.toLowerCase()}`;
		expect(parseApiKey(lower)).toEqual({
			keyid: material.keyid,
			secret: material.secret,
		});
	});

	it("rejects malformed tokens", () => {
		expect(parseApiKey("")).toBeNull();
		expect(
			parseApiKey("Bearer octo_ABCDEFGHIJKL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		).toBeNull();
		expect(
			parseApiKey("octo_SHORT_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		).toBeNull();
		expect(parseApiKey("octo_ABCDEFGHIJKL_SHORT")).toBeNull();
		expect(
			parseApiKey("octa_ABCDEFGHIJKL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		).toBeNull();
		expect(
			parseApiKey("octo_ABCDEFGHIJK1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		).toBeNull();
		expect(
			parseApiKey("octo_ABCDEFGHIJKL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"),
		).toBeNull();
	});
});

describe("timingSafeEqual", () => {
	it("compares equal and unequal strings without leaking length via true", () => {
		expect(timingSafeEqual("abcd", "abcd")).toBe(true);
		expect(timingSafeEqual("abcd", "abce")).toBe(false);
		expect(timingSafeEqual("abcd", "abc")).toBe(false);
		expect(timingSafeEqual("", "")).toBe(true);
		expect(timingSafeEqual("a", "")).toBe(false);
	});
});

describe("hashSecret", () => {
	it("HMACs the secret with the pepper and compares in constant time", async () => {
		const hash = await hashSecret("pepper", "secret");
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(await secretsMatch("pepper", "secret", hash)).toBe(true);
		expect(await secretsMatch("pepper", "other", hash)).toBe(false);
		expect(await secretsMatch("other", "secret", hash)).toBe(false);
		expect(await hashSecret("pepper", "secret")).toBe(hash);
	});
});
