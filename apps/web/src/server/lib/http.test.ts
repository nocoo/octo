import { describe, expect, it } from "vitest";
import { isoUtc, listEnvelope, serializeSpace, serializeTag } from "./http";

describe("http serializers", () => {
	it("emits iso utc and list envelopes", () => {
		expect(isoUtc(0)).toBe("1970-01-01T00:00:00.000Z");
		expect(listEnvelope([{ id: 1 }])).toEqual({ items: [{ id: 1 }], next_cursor: null });
		expect(
			serializeTag({
				id: "t",
				name: "a",
				display_name: "A",
				use_count: 2,
				created_at: 0,
				updated_at: 0,
				merged_into: "x",
			}),
		).toEqual({
			id: "t",
			name: "a",
			display_name: "A",
			use_count: 2,
			created_at: "1970-01-01T00:00:00.000Z",
			updated_at: "1970-01-01T00:00:00.000Z",
			merged_into: "x",
		});
		expect(
			serializeSpace({
				id: "s",
				slug: "kb",
				name: "kb",
				description: "",
				owner_key_id: null,
				memory_count: 0,
				created_at: 0,
				updated_at: 0,
			}),
		).toMatchObject({ created_at: "1970-01-01T00:00:00.000Z", memory_count: 0 });
	});
});
