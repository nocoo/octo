import { describe, expect, it } from "vitest";
import { MASTER_KEY, SECRET } from "./__tests__/fixture";
import { decryptApiKey, encryptApiKey } from "./crypto";

describe("embedding credential encryption", () => {
	it("encrypts with fresh IVs and authenticates ciphertext", async () => {
		const first = await encryptApiKey(MASTER_KEY, SECRET);
		const second = await encryptApiKey(MASTER_KEY, SECRET);
		expect(first.key_version).toBe(1);
		expect(first.iv.byteLength).toBe(12);
		expect(first.iv).not.toEqual(second.iv);
		expect(new TextDecoder().decode(first.ciphertext)).not.toContain(SECRET);
		expect(await decryptApiKey(MASTER_KEY, first)).toBe(SECRET);
		first.ciphertext[0] = (first.ciphertext[0] ?? 0) ^ 1;
		await expect(decryptApiKey(MASTER_KEY, first)).rejects.toThrow(
			"embedding settings unavailable",
		);
		await expect(decryptApiKey(btoa("abcdef0123456789abcdef0123456789"), second)).rejects.toThrow(
			"embedding settings unavailable",
		);
		await expect(decryptApiKey(MASTER_KEY, { ...second, key_version: 2 })).rejects.toThrow(
			"embedding settings unavailable",
		);
	});

	it.each([
		undefined,
		"",
		"%%%",
		"short",
		btoa("x".repeat(31)),
		btoa("x".repeat(33)),
		`${MASTER_KEY}\n`,
		MASTER_KEY.replace(/=$/, ""),
		`${MASTER_KEY.slice(0, -2)}h=`,
	])("rejects a noncanonical 32-byte master key (%s)", async (key) => {
		await expect(encryptApiKey(key, SECRET)).rejects.toThrow("embedding settings unavailable");
	});
});
