import { describe, expect, it } from "vitest";
import { runFtsChannel } from "./fts-channel";

describe("runFtsChannel", () => {
	it("uses a LIKE scan for all-short Chinese queries such as 部署", async () => {
		let sawLike = false;
		let sawMatch = false;
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("LIKE")) {
							sawLike = true;
							return { results: [{ id: "m2" }] };
						}
						if (sql.includes("MATCH")) {
							sawMatch = true;
						}
						return { results: [] };
					},
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "部署", ["s1"], undefined, 5);
		expect(sawLike).toBe(true);
		expect(sawMatch).toBe(false);
		expect(result.hits).toEqual([{ id: "m2", bm25: 1 }]);
		expect(result.partial).toBe(false);
	});

	it("re-applies space visibility when filtering short terms on fts candidates", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("MATCH")) {
							return { results: [{ id: "m1", score: -1 }] };
						}
						if (sql.includes("instr")) {
							return { results: [] };
						}
						return { results: [] };
					},
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare 部署", ["s1"], undefined, 5);
		expect(result.hits).toEqual([]);
	});

	it("marks partial when the short scan exceeds the row cap", async () => {
		const rows = Array.from({ length: 501 }, (_, i) => ({ id: `m${i}` }));
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("LIKE")) {
							return { results: rows };
						}
						return { results: [] };
					},
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "部署", ["s1"], undefined, 100);
		expect(result.partial).toBe(true);
		expect(result.hits.length).toBe(100);
	});

	it("returns empty for unknown tags_all names", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({ results: [] }),
					first: async () => null,
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare", ["s1"], { tags_all: ["ghost"] }, 5);
		expect(result.hits).toEqual([]);
	});

	it("filters 部署 with instr on fts candidates when mixed with long terms", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("MATCH")) {
							return {
								results: [
									{ id: "m1", score: -1 },
									{ id: "m2", score: -2 },
								],
							};
						}
						if (sql.includes("instr")) {
							return { results: [{ id: "m1" }] };
						}
						return { results: [] };
					},
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare 部署", ["s1"], undefined, 5);
		expect(result.hits).toEqual([{ id: "m1", bm25: -1 }]);
		expect(result.partial).toBe(false);
	});

	it("runs a short-query like scan", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("LIKE")) {
							return { results: [{ id: "m1" }] };
						}
						return { results: [] };
					},
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "部署", ["s1"], undefined, 10);
		expect(result.hits).toEqual([{ id: "m1", bm25: 1 }]);
	});

	it("returns empty when tags_all names do not resolve", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({ results: [] }),
					first: async () => null,
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare", ["s1"], { tags_all: ["ghost"] }, 5);
		expect(result.hits).toEqual([]);
	});

	it("returns empty for blank queries", async () => {
		const db = {
			prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
		} as never;
		expect(await runFtsChannel(db, "   ", ["s1"], undefined, 5)).toEqual({
			hits: [],
			partial: false,
		});
	});

	it("returns empty when tags_all cannot resolve", async () => {
		const db = {
			prepare: (_sql: string) => ({
				bind: () => ({
					all: async () => ({ results: [] }),
					first: async () => null,
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare", ["s1"], { tags_all: ["missing"] }, 5);
		expect(result.hits).toEqual([]);
	});

	it("runs fts match queries", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("MATCH")) {
							return { results: [{ id: "m1", score: -1 }] };
						}
						return { results: [] };
					},
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare", ["s1"], undefined, 5);
		expect(result.hits[0]?.id).toBe("m1");
	});

	it("returns early when short-term filtering has no hits", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({ all: async () => ({ results: [] }) }),
			}),
		} as never;
		const result = await runFtsChannel(db, "ab", ["s1"], undefined, 5);
		expect(result.hits).toEqual([]);
	});

	it("filters short terms from fts candidates", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("MATCH")) {
							return { results: [{ id: "m1", score: -1 }] };
						}
						if (sql.includes("SELECT id, body")) {
							return { results: [{ id: "m1", body: "no match" }] };
						}
						return { results: [] };
					},
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "ab cloudflare", ["s1"], undefined, 5);
		expect(result.hits).toEqual([]);
	});

	it("applies tags_any filters when tags resolve", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("MATCH")) {
							return { results: [{ id: "m1", score: -1 }] };
						}
						return { results: [] };
					},
					first: async () => ({ id: "t1", merged_into: null }),
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare", ["s1"], { tags_any: ["infra"] }, 5);
		expect(result.hits[0]?.id).toBe("m1");
	});

	it("applies tags_all filters when tags resolve", async () => {
		const db = {
			prepare: (sql: string) => ({
				bind: () => ({
					all: async () => {
						if (sql.includes("MATCH")) {
							return { results: [{ id: "m1", score: -1 }] };
						}
						return { results: [] };
					},
					first: async () => ({ id: "t1", merged_into: null }),
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare", ["s1"], { tags_all: ["infra"] }, 5);
		expect(result.hits[0]?.id).toBe("m1");
	});

	it("returns empty when tags_all names do not resolve", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({ results: [] }),
					first: async () => null,
				}),
			}),
		} as never;
		expect(await runFtsChannel(db, "cloudflare", ["s1"], { tags_all: ["ghost"] }, 5)).toEqual({
			hits: [],
			partial: false,
		});
	});

	it("returns empty for whitespace-only queries", async () => {
		const db = {
			prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
		} as never;
		expect(await runFtsChannel(db, "   ", ["s1"], undefined, 5)).toEqual({
			hits: [],
			partial: false,
		});
	});

	it("returns empty when tags_any cannot resolve", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({ results: [] }),
					first: async () => null,
				}),
			}),
		} as never;
		const result = await runFtsChannel(db, "cloudflare", ["s1"], { tags_any: ["nope"] }, 5);
		expect(result.hits).toEqual([]);
	});
});
