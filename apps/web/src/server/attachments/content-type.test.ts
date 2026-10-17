import { describe, expect, it } from "vitest";
import {
	isAllowedAttachmentType,
	MAX_ATTACHMENT_BYTES,
	normalizeContentType,
} from "./content-type";

describe("attachment content types", () => {
	it("normalizes parameters and case", () => {
		expect(normalizeContentType("Image/PNG; charset=binary")).toBe("image/png");
		expect(normalizeContentType("")).toBe("");
	});

	it("allows the whitelist", () => {
		for (const type of [
			"image/png",
			"image/jpeg",
			"image/webp",
			"image/gif",
			"image/svg+xml",
			"application/pdf",
		]) {
			expect(isAllowedAttachmentType(type)).toBe(true);
		}
		expect(isAllowedAttachmentType("text/plain")).toBe(false);
	});

	it("enforces the 50 MiB cap constant", () => {
		expect(MAX_ATTACHMENT_BYTES).toBe(52_428_800);
	});
});
