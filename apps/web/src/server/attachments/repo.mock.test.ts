import { describe, expect, it, vi } from "vitest";
import { AttachmentRepo } from "./repo";

describe("AttachmentRepo d1 edge cases", () => {
	it("returns empty list when results missing", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({}),
				}),
			}),
		} as unknown as D1Database;
		const repo = new AttachmentRepo({ db });
		expect(await repo.listForMemory("m1")).toEqual([]);
	});

	it("loads memory and attachment rows", async () => {
		const first = vi
			.fn()
			.mockResolvedValueOnce({ id: "m1", space_id: "s", source_key_id: "k", deleted_at: null })
			.mockResolvedValueOnce(null);
		const db = {
			prepare: () => ({
				bind: () => ({ first }),
			}),
		} as unknown as D1Database;
		const repo = new AttachmentRepo({ db });
		expect(await repo.getMemory("m1")).toMatchObject({ id: "m1" });
		expect(await repo.getAttachment("x")).toBeNull();
	});
});
