import { describe, expect, it } from "vitest";
import { attachmentDisposition, contentDispositionFilename } from "./disposition";

describe("content disposition", () => {
	it("escapes unsafe filename chars", () => {
		expect(contentDispositionFilename('a"b')).toBe('filename="a_b"');
	});

	it("forces svg to attachment", () => {
		expect(attachmentDisposition("x.svg", "image/svg+xml")).toBe('attachment; filename="x.svg"');
		expect(attachmentDisposition("x.png", "image/png")).toBe('inline; filename="x.png"');
	});
});
