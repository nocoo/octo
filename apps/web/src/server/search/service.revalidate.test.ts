import { describe, expect, it, vi } from "vitest";
import { revalidateVectorHits } from "./service";

describe("revalidateVectorHits", () => {
	it("filters in one SQL and preserves raw vector rank order", async () => {
		const bind = vi.fn(() => ({ all: async () => ({ results: [{ id: "a" }, { id: "b" }] }) }));
		const prepare = vi.fn((_sql: string) => ({ bind }));
		const hits = [
			{ id: "b", score: 1 },
			{ id: "ghost", score: 0.9 },
			{ id: "a", score: 0.8 },
		];
		expect(
			await revalidateVectorHits({ prepare } as never, hits, {
				clauses: ["m.space_id = ?"],
				binds: ["s1"],
			}),
		).toEqual([hits[0], hits[2]]);
		expect(prepare).toHaveBeenCalledOnce();
		expect(prepare.mock.calls[0]?.[0]).toContain("json_each(?)");
		expect(bind).toHaveBeenCalledWith("s1", '["b","ghost","a"]');
	});

	it("does not query when no vector ids exist", async () => {
		const prepare = vi.fn();
		expect(
			await revalidateVectorHits({ prepare } as never, [], { clauses: [], binds: [] }),
		).toEqual([]);
		expect(prepare).not.toHaveBeenCalled();
	});
});
