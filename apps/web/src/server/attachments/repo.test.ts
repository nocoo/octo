import { describe, expect, it } from "vitest";
import { attachmentR2Key } from "./repo";

describe("AttachmentRepo", () => {
	it("builds r2 keys", () => {
		expect(attachmentR2Key("m", "a")).toBe("att/m/a");
	});
});
