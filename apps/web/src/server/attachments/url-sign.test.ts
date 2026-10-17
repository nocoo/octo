import { describe, expect, it } from "vitest";
import {
	buildSignedFileUrl,
	DEFAULT_ATTACHMENT_URL_TTL_SECONDS,
	isExpired,
	signAttachmentUrl,
	signPayload,
	verifyAttachmentUrlSig,
} from "./url-sign";

describe("attachment url signing", () => {
	it("signs r2_key|exp", async () => {
		expect(signPayload("att/m/a", 99)).toBe("att/m/a|99");
		const sig = await signAttachmentUrl("secret", "att/m/a", 99);
		expect(await verifyAttachmentUrlSig("secret", "att/m/a", 99, sig)).toBe(true);
		expect(await verifyAttachmentUrlSig("secret", "att/m/a", 99, "deadbeef")).toBe(false);
	});

	it("builds public urls", async () => {
		const sig = await signAttachmentUrl("s", "att/x/y", 1);
		expect(buildSignedFileUrl("https://octo.hexly.ai", "att/x/y", 1, sig)).toBe(
			`https://octo.hexly.ai/files/att/x/y?exp=1&sig=${sig}`,
		);
	});

	it("checks expiry", () => {
		expect(DEFAULT_ATTACHMENT_URL_TTL_SECONDS).toBe(300);
		expect(isExpired(10, 11)).toBe(true);
		expect(isExpired(12, 11)).toBe(false);
	});
});
