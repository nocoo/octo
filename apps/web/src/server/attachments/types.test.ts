import { describe, expect, it } from "vitest";
import { type AttachmentRecord, toPublicAttachment } from "./types";

const row: AttachmentRecord = {
	id: "att1",
	memory_id: "m1",
	r2_key: "att/m1/att1",
	filename: "a.png",
	content_type: "image/png",
	size_bytes: 1,
	sha256: "h",
	created_by: "key:x",
	created_at: 1,
	deleted_at: null,
};

describe("toPublicAttachment", () => {
	it("omits markdown by default", () => {
		expect(toPublicAttachment(row)).toEqual({
			id: "att1",
			memory_id: "m1",
			filename: "a.png",
			content_type: "image/png",
			size_bytes: 1,
			sha256: "h",
			created_at: "1970-01-01T00:00:00.001Z",
		});
	});

	it("adds markdown reference on upload", () => {
		expect(toPublicAttachment(row, true).markdown).toBe("![](octo://att/att1)");
	});
});
