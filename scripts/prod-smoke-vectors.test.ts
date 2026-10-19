import { afterEach, describe, expect, it, vi } from "vitest";
import { main, runVectorSmoke, runVectorSmokeBatch } from "./prod-smoke-vectors";

const KEY = "secret-never-print-this";
const environment = {
	OCTO_SMOKE_BASE_URL: "https://smoke.example/",
	OCTO_SMOKE_API_KEY: KEY,
	OCTO_SMOKE_SPACE: "dedicated-smoke",
};
const ids = ["01JAAAAAAAAAAAAAAAAAAAAAAA", "01JBBBBBBBBBBBBBBBBBBBBBBB"];
type Stored = { id: string; version: number; body: string; tags: string[]; values: number[] };
type Call = {
	url: URL;
	init: RequestInit;
	body: Record<string, unknown>;
	time: number;
	tick: number;
};

function fixture(rtt = 1) {
	let time = 0;
	let tick = 0;
	const calls: Call[] = [];
	const memories: Stored[] = [];
	let override: ((call: Call) => Response | undefined) | undefined;
	const json = (value: unknown, status = 200) => Response.json(value, { status });
	const dependencies = {
		now: () => time,
		sleep: async (ms: number) => {
			time += ms;
			tick += 1;
		},
		fetch: vi.fn(async (url: string, init: RequestInit) => {
			time += rtt;
			const call: Call = {
				url: new URL(url),
				init,
				body: JSON.parse(String(init.body ?? "{}")),
				time,
				tick,
			};
			calls.push(call);
			const response = override?.(call);
			if (response) return response;
			const path = call.url.pathname;
			if (path.endsWith("/embedding-profiles")) {
				return json({
					active_profile: "tiny",
					items: [{ id: "tiny", dims: 3, metric: "cosine", active: true }],
				});
			}
			if (path.endsWith("/spaces/dedicated-smoke")) return json({ slug: "dedicated-smoke" });
			if (path.endsWith("/memories") && init.method === "POST") {
				const memory: Stored = {
					id: ids[memories.length] ?? `01J${String(memories.length).padStart(23, "0")}`,
					version: 1,
					body: String(call.body.body),
					tags: call.body.tags as string[],
					values: (call.body.vector as { values: number[] }).values,
				};
				memories.push(memory);
				return json(memory, 201);
			}
			if (path.endsWith("/search")) {
				const values = (call.body.vector as { values: number[] }).values;
				return json({
					items: memories
						.filter((memory) =>
							(call.body.filters as { tags_all: string[] }).tags_all.every((tag) =>
								memory.tags.includes(tag),
							),
						)
						.map((memory) => ({
							id: memory.id,
							scores: {
								vector: {
									similarity: memory.values.reduce((sum, n, i) => sum + n * (values[i] ?? 0), 0),
								},
							},
						}))
						.filter((item) => item.scores.vector.similarity > 0)
						.sort((a, b) => b.scores.vector.similarity - a.scores.vector.similarity),
				});
			}
			const memory = memories.find((item) => path.includes(item.id));
			if (!memory) throw new Error(`unexpected request ${KEY}`);
			if (init.method === "DELETE") return json({ trashed_at: "2026-10-19T00:00:00Z" });
			if (init.method === "PATCH" || init.method === "PUT") {
				expect(call.body.expected_version).toBe(memory.version);
				const changed =
					(call.body.body !== undefined && call.body.body !== memory.body) ||
					(call.body.tags !== undefined &&
						JSON.stringify(call.body.tags) !== JSON.stringify(memory.tags)) ||
					(call.body.values !== undefined &&
						JSON.stringify(call.body.values) !== JSON.stringify(memory.values));
				if (call.body.body !== undefined) memory.body = String(call.body.body);
				if (call.body.tags !== undefined) memory.tags = call.body.tags as string[];
				if (call.body.values !== undefined) memory.values = call.body.values as number[];
				if (changed) memory.version += 1;
				return json(memory);
			}
			expect(call.url.searchParams.get("include")).toBe("vector_status");
			return json({
				...memory,
				vector_status: [{ profile: "tiny", indexed: true, stale: false, embedding_calls: 0 }],
			});
		}),
	};
	return {
		calls,
		memories,
		dependencies,
		json,
		setOverride: (fn: typeof override) => {
			override = fn;
		},
		advance: (ms: number) => {
			time += ms;
		},
		setRtt: (ms: number) => {
			rtt = ms;
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("repeated vector smoke reports", () => {
	it("defaults to one run with per-metric sample counts and p50/max", async () => {
		const transport = fixture();
		const report = await runVectorSmokeBatch(environment, transport.dependencies);
		expect(report.ok).toBe(true);
		expect(report.runs).toHaveLength(1);
		expect(report.failures).toEqual([]);
		for (const [metric, latency] of Object.entries(report.runs[0]?.latencies_ms ?? {})) {
			expect(report.latencies_ms[metric as keyof typeof report.latencies_ms]).toEqual({
				samples: 1,
				p50: latency,
				max: latency,
			});
		}
	});

	it.each([2, 3])("isolates %i runs and reports median/max", async (runs) => {
		const transport = fixture();
		const delays = [100, 800, 300];
		let started = 0;
		transport.setOverride((call) => {
			if (call.url.pathname.includes("/spaces/")) {
				transport.setRtt(delays[started] ?? 1);
				started += 1;
			}
		});
		const report = await runVectorSmokeBatch(
			{ ...environment, OCTO_SMOKE_RUNS: String(runs) },
			transport.dependencies,
		);
		expect(report.ok).toBe(true);
		expect(report.runs).toHaveLength(runs);
		expect(new Set(report.runs.map((run) => run.run)).size).toBe(runs);
		const medianRtt = runs === 2 ? 450 : 300;
		const maxRtt = 800;
		expect(report.latencies_ms).toEqual({
			create_indexed: { samples: runs, p50: medianRtt * 2, max: maxRtt * 2 },
			create_vector_hit: { samples: runs, p50: medianRtt * 3 + 250, max: maxRtt * 3 + 250 },
			update_new_rank1: { samples: runs, p50: medianRtt * 2 + 250, max: maxRtt * 2 + 250 },
			update_old_gone: { samples: runs, p50: medianRtt * 4 + 750, max: maxRtt * 4 + 750 },
		});
		for (const run of report.runs) {
			expect(run.cleanup).toEqual({ attempted: 2, deleted: 2, errors: [] });
			expect(run.duplicate_checks).toBeGreaterThan(0);
			expect(Object.values(run.embedding_calls)).toEqual([0, 0, 0, 0, 0, 0]);
		}
		const deletes = transport.calls.filter((call) => call.init.method === "DELETE");
		expect(new Set(deletes.map((call) => call.url.pathname)).size).toBe(runs * 2);
		expect(JSON.stringify(report)).not.toContain(KEY);
	});

	it("retains failed-run evidence, cleans up and continues without inventing missing latencies", async () => {
		const transport = fixture();
		transport.setOverride((call) => {
			if (!call.url.pathname.endsWith("/search")) return;
			if (transport.memories.length === 2) return transport.json({ items: [] });
		});
		const report = await runVectorSmokeBatch(
			{ ...environment, OCTO_SMOKE_RUNS: "2" },
			transport.dependencies,
		);
		expect(report.ok).toBe(false);
		expect(report.runs.map((run) => run.ok)).toEqual([false, true]);
		expect(report.runs.map((run) => run.cleanup.deleted)).toEqual([2, 2]);
		expect(report.runs[0]?.failures).toContainEqual({ phase: "create", code: "deadline_exceeded" });
		expect(report.latencies_ms.create_vector_hit).toEqual({ samples: 1, p50: 253, max: 253 });
		expect(report.latencies_ms.create_indexed.samples).toBe(2);
	});

	it("returns null summaries rather than zero for metrics never observed", async () => {
		const transport = fixture();
		transport.setOverride(() => transport.json({ error: KEY }, 403));
		const report = await runVectorSmokeBatch(
			{ ...environment, OCTO_SMOKE_RUNS: "2" },
			transport.dependencies,
		);
		expect(report.ok).toBe(false);
		expect(report.runs).toHaveLength(2);
		for (const summary of Object.values(report.latencies_ms)) {
			expect(summary).toEqual({ samples: 0, p50: null, max: null });
		}
		expect(JSON.stringify(report)).not.toContain(KEY);
	});

	it.each(["", "0", "-1", "1.5", "01", " 2", "2 ", "NaN", "Infinity", "9007199254740992", KEY])(
		"rejects invalid run counts before transport calls (%s)",
		async (runs) => {
			const transport = fixture();
			const report = await runVectorSmokeBatch(
				{ ...environment, OCTO_SMOKE_RUNS: runs },
				transport.dependencies,
			);
			expect(report.ok).toBe(false);
			expect(report.runs).toEqual([]);
			expect(report.failures).toEqual([{ phase: "config", code: "invalid_environment" }]);
			expect(transport.calls).toHaveLength(0);
			expect(JSON.stringify(report)).not.toContain(KEY);
		},
	);
});

describe("production vector smoke with fake transport only", () => {
	it.each([
		["create", true],
		["update", true],
		["create", false],
		["update", false],
	] as const)(
		"ends the %s fractional window without a spurious timeout (converged=%s)",
		async (stage, converged) => {
			vi.useFakeTimers();
			const transport = fixture(1_300.4);
			transport.setOverride((call) =>
				!converged && call.url.pathname.endsWith("/search")
					? transport.json({ items: [] })
					: undefined,
			);
			const fetch = transport.dependencies.fetch;
			let start: number | undefined;
			let interrupted = false;
			let signal: AbortSignal | null | undefined;
			transport.dependencies.fetch = vi.fn(async (url, init) => {
				const remaining =
					start === undefined ? Infinity : start + 10_000 - transport.dependencies.now();
				if (
					!interrupted &&
					remaining > 0 &&
					remaining < 2_000 &&
					(url.endsWith("/search") || url.includes("include=vector_status"))
				) {
					interrupted = true;
					signal = init.signal;
					transport.advance(Math.floor(remaining));
					return new Promise<Response>(() => {});
				}
				const response = await fetch(url, init);
				if (
					start === undefined &&
					(stage === "create"
						? init.method === "POST" && url.endsWith("/memories")
						: init.method === "PUT")
				) {
					start = transport.dependencies.now();
				}
				return response;
			});
			const promise = runVectorSmoke(environment, transport.dependencies);
			await vi.runAllTimersAsync();
			const report = await promise;
			expect(interrupted).toBe(true);
			expect(signal?.aborted).toBe(true);
			expect(report.ok).toBe(converged);
			if (converged) {
				expect(report.failures).toEqual([]);
				expect(Object.values(report.latencies_ms).every((latency) => latency !== null)).toBe(true);
			} else {
				expect(report.failures).toContainEqual({ phase: stage, code: "deadline_exceeded" });
				expect(report.failures.some((failure) => failure.code === "request_timeout")).toBe(false);
			}
			expect(report.cleanup.deleted).toBe(2);
		},
	);

	it("still fails an ordinary request timeout with observation time remaining", async () => {
		vi.useFakeTimers();
		const transport = fixture(1_300.4);
		const fetch = transport.dependencies.fetch;
		transport.dependencies.fetch = vi.fn(async (url, init) => {
			if (url.includes("include=vector_status")) return new Promise<Response>(() => {});
			return fetch(url, init);
		});
		const promise = runVectorSmoke(environment, transport.dependencies);
		await vi.runAllTimersAsync();
		const report = await promise;
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([{ phase: "create", code: "request_timeout" }]);
		expect(report.cleanup.deleted).toBe(2);
	});

	it.each([0, 1])("rejects ordinary timeouts delayed by %i ms", async (delay) => {
		vi.useFakeTimers();
		const transport = fixture(1_349.9);
		const fetch = transport.dependencies.fetch;
		let updateStart: number | undefined;
		let interrupted = false;
		transport.dependencies.fetch = vi.fn(async (url, init) => {
			const remaining =
				updateStart === undefined ? Infinity : updateStart + 10_000 - transport.dependencies.now();
			if (!interrupted && remaining > 2_000 && remaining < 2_001) {
				interrupted = true;
				transport.advance(2_000 + delay);
				return new Promise<Response>(() => {});
			}
			const response = await fetch(url, init);
			if (init.method === "PUT" && updateStart === undefined) {
				updateStart = transport.dependencies.now();
			}
			return response;
		});
		const promise = runVectorSmoke(
			{ ...environment, OCTO_SMOKE_REQUEST_TIMEOUT_MS: "2000" },
			transport.dependencies,
		);
		await vi.runAllTimersAsync();
		const report = await promise;
		expect(interrupted).toBe(true);
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([{ phase: "update", code: "request_timeout" }]);
		expect(Object.values(report.latencies_ms).every((latency) => latency !== null)).toBe(true);
		expect(report.cleanup.deleted).toBe(2);
	});

	it.each([1, 1_300])("measures convergence after write responses with %i ms RTT", async (rtt) => {
		const transport = fixture(rtt);
		const report = await runVectorSmoke(environment, transport.dependencies);
		expect(report.ok).toBe(true);
		expect(report.latencies_ms).toEqual({
			create_indexed: rtt * 2,
			create_vector_hit: rtt * 3 + 250,
			update_new_rank1: rtt * 2 + 250,
			update_old_gone: rtt * 4 + 750,
		});
		expect(report.embedding_calls.put).toBe(0);
		expect(report.embedding_calls.final).toBe(0);
		expect(report.cleanup.deleted).toBe(2);
	});

	it.each(["lower-rank", "low-similarity", "fts-only", "absent", "later-regression"])(
		"ignores hybrid %s for update rank-one convergence",
		async (kind) => {
			const transport = fixture();
			let hybridPolls = 0;
			transport.setOverride((call) => {
				if (
					call.body.mode !== "hybrid" ||
					(call.body.vector as { values: number[] }).values[1] !== 1
				)
					return;
				hybridPolls += 1;
				if (kind === "later-regression" && hybridPolls === 1) return;
				const target = { id: ids[0], scores: { vector: { similarity: 1 } } };
				return transport.json({
					items:
						kind === "lower-rank"
							? [{ id: ids[1], scores: { vector: { similarity: 0.8 } } }, target]
							: kind === "low-similarity"
								? [{ ...target, scores: { vector: { similarity: 0.98 } } }]
								: kind === "fts-only"
									? [{ ...target, scores: { vector: null } }]
									: [],
				});
			});
			const report = await runVectorSmoke(environment, transport.dependencies);
			expect(report.ok).toBe(true);
			expect(report.latencies_ms.update_new_rank1).toBe(252);
			expect(hybridPolls).toBeGreaterThan(1);
			expect(report.cleanup.deleted).toBe(2);
		},
	);

	it.each(["wrong-rank", "low-similarity", "fts-only", "absent", "stale", "unindexed"])(
		"rejects update convergence with vector evidence %s",
		async (kind) => {
			const transport = fixture();
			transport.setOverride((call) => {
				const target = transport.memories[0];
				if (target?.values[1] !== 1) return;
				if (
					(kind === "stale" || kind === "unindexed") &&
					call.init.method === "GET" &&
					call.url.pathname.endsWith(target.id)
				) {
					return transport.json({
						...target,
						vector_status: [
							{
								profile: "tiny",
								indexed: kind !== "unindexed",
								stale: kind === "stale",
								embedding_calls: 0,
							},
						],
					});
				}
				if (
					call.body.mode !== "vector" ||
					(call.body.vector as { values: number[] }).values[1] !== 1
				)
					return;
				if (kind === "stale" || kind === "unindexed") return;
				return transport.json({
					items:
						kind === "wrong-rank"
							? [
									{ id: ids[1], scores: { vector: { similarity: 1 } } },
									{ id: ids[0], scores: { vector: { similarity: 1 } } },
								]
							: kind === "low-similarity"
								? [{ id: ids[0], scores: { vector: { similarity: 0.989 } } }]
								: kind === "fts-only"
									? [{ id: ids[0], scores: { vector: null } }]
									: [],
				});
			});
			const report = await runVectorSmoke(environment, transport.dependencies);
			expect(report.ok).toBe(false);
			expect(report.latencies_ms.update_new_rank1).toBeNull();
			expect(report.failures).toEqual([{ phase: "update", code: "deadline_exceeded" }]);
			expect(report.cleanup.deleted).toBe(2);
		},
	);

	it("accepts the vector similarity threshold and detects later vector regressions", async () => {
		const transport = fixture();
		let vectorPolls = 0;
		transport.setOverride((call) => {
			if (call.body.mode !== "vector" || (call.body.vector as { values: number[] }).values[1] !== 1)
				return;
			vectorPolls += 1;
			return transport.json({
				items: vectorPolls === 1 ? [{ id: ids[0], scores: { vector: { similarity: 0.99 } } }] : [],
			});
		});
		const report = await runVectorSmoke(environment, transport.dependencies);
		expect(report.latencies_ms.update_new_rank1).toBe(252);
		expect(report.failures).toEqual([{ phase: "update", code: "convergence_regressed" }]);
		expect(report.cleanup.deleted).toBe(2);
	});

	it.each([0, 1])("still rejects duplicates in update hybrid vector %i", async (firstValue) => {
		const transport = fixture();
		transport.setOverride((call) => {
			if (
				transport.memories[0]?.values[1] !== 1 ||
				call.body.mode !== "hybrid" ||
				(call.body.vector as { values: number[] }).values[0] !== firstValue
			)
				return;
			const item = { id: ids[1], scores: { vector: null } };
			return transport.json({ items: [item, item] });
		});
		const report = await runVectorSmoke(environment, transport.dependencies);
		expect(report.ok).toBe(false);
		expect(report.latencies_ms.update_new_rank1).toBe(252);
		expect(report.failures).toEqual([{ phase: "update", code: "duplicate_memory_ids" }]);
		expect(report.cleanup.deleted).toBe(2);
	});

	it("makes exactly one request per observation tick", async () => {
		const transport = fixture();
		const report = await runVectorSmoke(environment, transport.dependencies);
		const firstRead = transport.calls.findIndex((call) => call.url.searchParams.has("include"));
		const firstPatch = transport.calls.findIndex((call) => call.init.method === "PATCH");
		const firstPut = transport.calls.findIndex((call) => call.init.method === "PUT");
		const lastPut = transport.calls.map((call) => call.init.method).lastIndexOf("PUT");
		const createPolls = transport.calls
			.slice(firstRead, firstPatch)
			.filter((call) => !call.url.pathname.includes(String(ids[1])));
		const updatePolls = transport.calls.slice(firstPut + 1, lastPut);
		for (const [stage, polls] of [
			["create", createPolls],
			["update", updatePolls],
		] as const) {
			expect(polls.length).toBe(report.polls[stage]);
			expect(new Set(polls.map((call) => call.tick)).size).toBe(polls.length);
		}
	});

	it("measures both full observation windows, client-vector economy and scoped repeated searches", async () => {
		const f = fixture();
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.ok).toBe(true);
		expect(report.failures).toEqual([]);
		expect(report.cleanup).toEqual({ attempted: 2, deleted: 2, errors: [] });
		for (const latency of Object.values(report.latencies_ms)) {
			expect(latency).toBeGreaterThan(0);
			expect(latency).toBeLessThan(10_000);
		}
		expect(report.embedding_calls).toEqual({
			create: 0,
			noop: 0,
			tags: 0,
			patch: 0,
			put: 0,
			final: 0,
		});
		expect(report.embedding_call_deltas).toEqual({ put_since_patch: 0, final_since_patch: 0 });
		expect(report.post_patch_attribution).toBe("unverified_body_patch_may_embed");
		expect(report.polls.create).toBeGreaterThan(3);
		expect(report.polls.update).toBeGreaterThan(3);
		const creates = f.calls.filter(
			(call) => call.init.method === "POST" && call.url.pathname.endsWith("/memories"),
		);
		expect(creates).toHaveLength(2);
		for (const create of creates) {
			expect(create.body.space).toBe(environment.OCTO_SMOKE_SPACE);
			expect(create.body.title).toContain(report.run);
			expect(create.body.tags).toContain(report.run);
		}
		const searches = f.calls.filter((call) => call.url.pathname.endsWith("/search"));
		expect(new Set(searches.map((call) => call.body.mode))).toEqual(new Set(["vector", "hybrid"]));
		for (const call of searches) {
			expect(call.body.filters).toEqual({ spaces: ["dedicated-smoke"], tags_all: [report.run] });
		}
		for (const call of f.calls) {
			expect(call.url.origin).toBe("https://smoke.example");
			expect(call.init.redirect).toBe("error");
			expect(call.init.signal).toBeInstanceOf(AbortSignal);
			expect(new Headers(call.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
		}
		expect(
			f.calls.filter((call) => call.init.method === "DELETE").map((call) => call.url.pathname),
		).toEqual(ids.map((id) => `/api/v1/memories/${id}`));
		expect(JSON.stringify(report)).not.toContain(KEY);
	});

	it.each(["indexed", "hit", "new", "old"])(
		"fails the strict deadline for %s without skipping cleanup",
		async (kind) => {
			const f = fixture();
			f.setOverride((call) => {
				if (
					kind === "indexed" &&
					call.init.method === "GET" &&
					call.url.searchParams.has("include")
				) {
					return f.json({
						...f.memories.find((m) => call.url.pathname.includes(m.id)),
						vector_status: [{ profile: "tiny", indexed: false, stale: false, embedding_calls: 0 }],
					});
				}
				if (!call.url.pathname.endsWith("/search")) return;
				if (kind === "hit") return f.json({ items: [] });
				const updated = f.memories.find((memory) => memory.body.includes("updated"));
				if (kind === "new" && updated) return f.json({ items: [] });
				if (kind === "old" && updated)
					return f.json({ items: [{ id: updated.id, scores: { vector: { similarity: 1 } } }] });
			});
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.ok).toBe(false);
			expect(report.failures.some((failure) => failure.code === "deadline_exceeded")).toBe(true);
			expect(report.cleanup.deleted).toBe(2);
		},
	);

	it.each(["vector", "hybrid"])("detects duplicate IDs on later %s polls", async (mode) => {
		const f = fixture();
		let count = 0;
		f.setOverride((call) => {
			if (!call.url.pathname.endsWith("/search") || call.body.mode !== mode || ++count !== 4)
				return;
			const item = { id: ids[0], scores: { vector: { similarity: 1 } } };
			return f.json({ items: [item, item] });
		});
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.ok).toBe(false);
		expect(report.failures).toContainEqual({ phase: "create", code: "duplicate_memory_ids" });
		expect(report.cleanup.deleted).toBe(2);
	});

	it("detects a search convergence regression after the first successful sample", async () => {
		const f = fixture();
		let count = 0;
		f.setOverride((call) =>
			call.url.pathname.endsWith("/search") && ++count === 5 ? f.json({ items: [] }) : undefined,
		);
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.failures).toContainEqual({ phase: "create", code: "convergence_regressed" });
	});

	it.each([undefined, -1, "0", 1])(
		"rejects unavailable or nonzero embedding counters (%s)",
		async (counter) => {
			const f = fixture();
			f.setOverride((call) =>
				call.url.searchParams.has("include")
					? f.json({
							id: ids[0],
							version: 1,
							vector_status: [
								{ profile: "tiny", indexed: true, stale: false, embedding_calls: counter },
							],
						})
					: undefined,
			);
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.ok).toBe(false);
			expect(report.cleanup.deleted).toBe(2);
		},
	);

	it("reads an absent-vector counter but cannot claim index convergence", async () => {
		const f = fixture();
		f.setOverride((call) =>
			call.url.searchParams.has("include")
				? f.json({
						id: f.memories.find((m) => call.url.pathname.includes(m.id))?.id,
						version: 1,
						vector_status: [{ profile: "tiny", indexed: false, stale: true, embedding_calls: 0 }],
					})
				: undefined,
		);
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.embedding_calls.create).toBe(0);
		expect(report.latencies_ms.create_indexed).toBeNull();
		expect(report.ok).toBe(false);
	});

	it("sanitizes operation and cleanup failures and only deletes IDs obtained from its own creates", async () => {
		const f = fixture();
		f.setOverride((call) => {
			if (call.init.method === "PATCH") throw new Error(`network headers/body ${KEY}`);
			if (call.init.method === "DELETE" && call.url.pathname.includes(String(ids[0]))) {
				return f.json({ error: { message: KEY } }, 403);
			}
		});
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.ok).toBe(false);
		expect(report.cleanup.attempted).toBe(2);
		expect(report.cleanup.deleted).toBe(1);
		expect(report.cleanup.errors).toEqual([{ phase: "cleanup", code: "http_error", status: 403 }]);
		expect(JSON.stringify(report)).not.toContain(KEY);
		expect(report.failures).toContainEqual({ phase: "noop", code: "request_failed" });
	});

	it("cleans the first create when the second operation fails", async () => {
		const f = fixture();
		f.setOverride((call) =>
			call.init.method === "POST" &&
			call.url.pathname.endsWith("/memories") &&
			f.memories.length === 1
				? f.json({ error: KEY }, 500)
				: undefined,
		);
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.cleanup).toEqual({ attempted: 1, deleted: 1, errors: [] });
		expect(report.ok).toBe(false);
	});

	it.each(["..", "../trash/empty", "%2e%2e", "//evil.example", `id?key=${KEY}`])(
		"rejects unsafe returned IDs (%s) without arbitrary cleanup",
		async (id) => {
			const f = fixture();
			f.setOverride((call) =>
				call.url.pathname.endsWith("/memories") ? f.json({ id, version: 1 }) : undefined,
			);
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.ok).toBe(false);
			expect(report.cleanup.attempted).toBe(0);
			expect(f.calls.some((call) => call.init.method === "DELETE")).toBe(false);
			expect(JSON.stringify(report)).not.toContain(KEY);
		},
	);

	it.each([
		{},
		{ ...environment, OCTO_SMOKE_API_KEY: "" },
		{ ...environment, OCTO_SMOKE_SPACE: ".." },
		{ ...environment, OCTO_SMOKE_BASE_URL: "https://evil.example/path/../" },
		{ ...environment, OCTO_SMOKE_BASE_URL: `https://user:${KEY}@smoke.example` },
		{ ...environment, OCTO_SMOKE_BASE_URL: `https://smoke.example?key=${KEY}` },
		{ ...environment, OCTO_SMOKE_BASE_URL: "http://smoke.example" },
	])("validates env before any transport calls", async (env) => {
		const f = fixture();
		const report = await runVectorSmoke(env, f.dependencies);
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([{ phase: "config", code: "invalid_environment" }]);
		expect(f.calls).toHaveLength(0);
		expect(JSON.stringify(report)).not.toContain(KEY);
	});

	it.each(["space", "profile", "dimensions", "metric", "json"])(
		"fails closed on unexpected %s schema",
		async (kind) => {
			const f = fixture();
			f.setOverride((call) => {
				if (kind === "space" && call.url.pathname.includes("/spaces/"))
					return f.json({ slug: "wrong" });
				if (!call.url.pathname.endsWith("/embedding-profiles")) return;
				if (kind === "json") return new Response(KEY);
				return f.json({
					active_profile: kind === "profile" ? null : "tiny",
					items: [
						{
							id: "tiny",
							dims: kind === "dimensions" ? 1 : 3,
							metric: kind === "metric" ? "euclidean" : "cosine",
							active: true,
						},
					],
				});
			});
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.ok).toBe(false);
			expect(report.cleanup.attempted).toBe(0);
			expect(JSON.stringify(report)).not.toContain(KEY);
		},
	);

	it.each(["", "0", "-1", "1.5", "01", " 2", "2 ", "NaN", "Infinity", "2147483648", KEY])(
		"rejects invalid request timeout %s before transport calls",
		async (timeout) => {
			const transport = fixture();
			const report = await runVectorSmoke(
				{ ...environment, OCTO_SMOKE_REQUEST_TIMEOUT_MS: timeout },
				transport.dependencies,
			);
			expect(report.ok).toBe(false);
			expect(report.failures).toEqual([{ phase: "config", code: "invalid_environment" }]);
			expect(transport.calls).toHaveLength(0);
			expect(JSON.stringify(report)).not.toContain(KEY);
		},
	);

	it.each([
		[undefined, 8_000],
		["1", 1],
		["2500", 2_500],
		["12000", 12_000],
		["2147483647", 2_147_483_647],
	] as const)("bounds unresolved requests with timeout %s", async (configured, timeout) => {
		vi.useFakeTimers();
		let signal: AbortSignal | null | undefined;
		const promise = runVectorSmoke(
			{ ...environment, OCTO_SMOKE_REQUEST_TIMEOUT_MS: configured },
			{
				fetch: async (_url, init) => {
					signal = init.signal;
					return new Promise<Response>(() => {});
				},
			},
		);
		await vi.advanceTimersByTimeAsync(timeout - 1);
		expect(signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		const report = await promise;
		expect(signal?.aborted).toBe(true);
		expect(report.failures).toEqual([{ phase: "setup", code: "request_timeout" }]);
	});

	it("applies the configured timeout to response bodies and cleanup", async () => {
		vi.useFakeTimers();
		const transport = fixture();
		const fetch = transport.dependencies.fetch;
		const signals: (AbortSignal | null | undefined)[] = [];
		transport.dependencies.fetch = vi.fn(async (url, init) => {
			if (url.includes("include=vector_status") || init.method === "DELETE") {
				signals.push(init.signal);
				return new Response(new ReadableStream());
			}
			return fetch(url, init);
		});
		const promise = runVectorSmoke(
			{ ...environment, OCTO_SMOKE_REQUEST_TIMEOUT_MS: "3000" },
			transport.dependencies,
		);
		await vi.advanceTimersByTimeAsync(8_999);
		expect(signals[2]?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		const report = await promise;
		expect(report.failures).toEqual([{ phase: "create", code: "request_timeout" }]);
		expect(report.cleanup).toEqual({
			attempted: 2,
			deleted: 0,
			errors: Array.from({ length: 2 }, () => ({ phase: "cleanup", code: "request_timeout" })),
		});
		expect(signals).toHaveLength(3);
		expect(signals.every((signal) => signal?.aborted)).toBe(true);
	});

	it("caps a longer request timeout at the observation deadline", async () => {
		vi.useFakeTimers();
		const transport = fixture();
		const fetch = transport.dependencies.fetch;
		let signal: AbortSignal | null | undefined;
		transport.dependencies.fetch = vi.fn(async (url, init) => {
			if (!signal && url.includes("include=vector_status")) {
				signal = init.signal;
				return new Promise<Response>(() => {});
			}
			return fetch(url, init);
		});
		const promise = runVectorSmoke(
			{ ...environment, OCTO_SMOKE_REQUEST_TIMEOUT_MS: "12000" },
			transport.dependencies,
		);
		await vi.advanceTimersByTimeAsync(9_998);
		expect(signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		const report = await promise;
		expect(signal?.aborted).toBe(true);
		expect(report.failures).toEqual([{ phase: "create", code: "deadline_exceeded" }]);
		expect(report.latencies_ms.create_indexed).toBeNull();
		expect(report.latencies_ms.create_vector_hit).toBeNull();
		expect(report.cleanup.deleted).toBe(2);
	});

	it("prints only JSON and returns nonzero without command-line secrets", async () => {
		for (const key of Object.keys(environment)) vi.stubEnv(key, "");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await main()).toBe(1);
		expect(log).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false });
	});

	it.each(["PATCH", "PUT"])(
		"rejects a %s response that changes the target ID before any further write",
		async (method) => {
			const f = fixture();
			const foreign = "01JCCCCCCCCCCCCCCCCCCCCCCC";
			f.setOverride((call) =>
				call.init.method === method ? f.json({ id: foreign, version: 2 }) : undefined,
			);
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.failures.some((item) => item.code === "unexpected_memory_id")).toBe(true);
			expect(f.calls.some((call) => call.url.pathname.includes(foreign))).toBe(false);
			expect(report.cleanup.deleted).toBe(2);
		},
	);

	it("does not accept convergence first observed exactly at the deadline", async () => {
		const f = fixture();
		let delayed = false;
		f.setOverride((call) => {
			if (!delayed && call.url.searchParams.has("include")) {
				delayed = true;
				f.advance(9_998);
			}
		});
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.ok).toBe(false);
		expect(report.latencies_ms.create_indexed).toBeNull();
		expect(report.failures).toContainEqual({ phase: "create", code: "deadline_exceeded" });
		expect(report.cleanup.deleted).toBe(2);
	});

	it.each(["noop", "tags"])(
		"observes and fails nonzero embedding attempts in %s",
		async (stage) => {
			const f = fixture();
			let current = "create";
			f.setOverride((call) => {
				if (call.init.method === "PATCH")
					current = call.body.tags
						? "tags"
						: call.body.body?.toString().includes("updated")
							? "body"
							: "noop";
				if (call.init.method === "PUT") current = current === "body" ? "put" : "final";
				if (current === stage && call.url.searchParams.has("include")) {
					const memory = f.memories.find((m) => call.url.pathname.includes(m.id));
					return f.json({
						...memory,
						vector_status: [{ profile: "tiny", indexed: true, stale: false, embedding_calls: 1 }],
					});
				}
			});
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.ok).toBe(false);
			expect(report.embedding_calls[stage as "noop" | "tags"]).toBe(1);
			expect(report.failures.some((failure) => failure.code === "embedding_calls_nonzero")).toBe(
				true,
			);
		},
	);

	it.each(["missing", "duplicate", "other-profile"])(
		"rejects %s active vector status rather than inventing a zero counter",
		async (kind) => {
			const f = fixture();
			const entry = {
				profile: kind === "other-profile" ? "other" : "tiny",
				indexed: true,
				stale: false,
				embedding_calls: 0,
			};
			f.setOverride((call) =>
				call.url.searchParams.has("include")
					? f.json({
							id: ids[0],
							version: 1,
							vector_status:
								kind === "missing" ? [] : kind === "duplicate" ? [entry, entry] : [entry],
						})
					: undefined,
			);
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.failures).toContainEqual({ phase: "create", code: "missing_vector_status" });
			expect(report.cleanup.deleted).toBe(2);
		},
	);

	it("detects a server repeating a created ID and only cleans it once", async () => {
		const f = fixture();
		f.setOverride((call) =>
			call.init.method === "POST" &&
			call.url.pathname.endsWith("/memories") &&
			f.memories.length === 1
				? f.json({ id: ids[0], version: 1 })
				: undefined,
		);
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.failures).toContainEqual({ phase: "create", code: "duplicate_created_id" });
		expect(report.cleanup).toEqual({ attempted: 1, deleted: 1, errors: [] });
	});

	it.each(["PATCH", "PUT"])(
		"detects a %s no-op incorrectly changing the version",
		async (method) => {
			const f = fixture();
			let puts = 0;
			f.setOverride((call) => {
				if (call.init.method === "PUT") puts += 1;
				if (
					call.init.method !== method ||
					(method === "PUT" ? puts !== 2 : call.body.body !== f.memories[0]?.body)
				)
					return;
				const memory = f.memories[0];
				if (memory) memory.version += 1;
				return f.json(memory);
			});
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.failures.some((item) => item.code === "noop_changed_version")).toBe(true);
		},
	);

	it("does not confuse hybrid FTS-only items with vector matches", async () => {
		const f = fixture();
		f.setOverride((call) =>
			call.url.pathname.endsWith("/search")
				? f.json({ items: [{ id: ids[0], scores: { vector: null } }] })
				: undefined,
		);
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.ok).toBe(false);
		expect(report.latencies_ms.create_vector_hit).toBeNull();
	});

	it("sanitizes unexpected runtime errors and still cleans up", async () => {
		const f = fixture();
		f.dependencies.sleep = async () => {
			throw new Error(KEY);
		};
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.failures).toContainEqual({ phase: "create", code: "runtime_error" });
		expect(report.cleanup.deleted).toBe(2);
		expect(JSON.stringify(report)).not.toContain(KEY);
	});

	it("rejects a malformed origin without echoing URL parser errors", async () => {
		const f = fixture();
		const report = await runVectorSmoke(
			{ ...environment, OCTO_SMOKE_BASE_URL: "https://[invalid]" },
			f.dependencies,
		);
		expect(report.failures).toEqual([{ phase: "config", code: "invalid_environment" }]);
		expect(f.calls).toHaveLength(0);
	});

	it.each([undefined, "2"])("runs the CLI with %s runs on fake timers and fetch", async (runs) => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
		const f = fixture();
		for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
		vi.stubEnv("OCTO_SMOKE_RUNS", runs);
		vi.spyOn(globalThis, "fetch").mockImplementation((url, init) =>
			f.dependencies.fetch(String(url), init ?? {}),
		);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const promise = main();
		await vi.runAllTimersAsync();
		expect(await promise).toBe(0);
		expect(log).toHaveBeenCalledTimes(1);
		const report = JSON.parse(String(log.mock.calls[0]?.[0]));
		expect(report).toMatchObject({ ok: true });
		expect(report.runs).toHaveLength(Number(runs ?? 1));
		expect(report.latencies_ms.create_indexed.samples).toBe(Number(runs ?? 1));
		expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
	});

	it("reports only a fixed code if CLI startup itself throws sensitive text", async () => {
		vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
			throw new Error(KEY);
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await main()).toBe(1);
		expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
			ok: false,
			failures: [{ phase: "runtime", code: "runtime_error" }],
		});
	});

	it("fails old-vector disappearance even for a low positive stale match", async () => {
		const f = fixture();
		f.setOverride((call) => {
			const target = f.memories[0];
			if (
				target?.body.includes("updated") &&
				call.url.pathname.endsWith("/search") &&
				(call.body.vector as { values: number[] }).values[0] === 1
			) {
				return f.json({ items: [{ id: target.id, scores: { vector: { similarity: 0.01 } } }] });
			}
		});
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.latencies_ms.update_old_gone).toBeNull();
		expect(report.failures).toContainEqual({ phase: "update", code: "deadline_exceeded" });
		expect(report.ok).toBe(false);
		expect(report.cleanup.deleted).toBe(2);
	});

	it.each(["patch", "put", "final"])(
		"reports %s embedding work after body-only PATCH without attributing it to PUT",
		async (stage) => {
			const f = fixture();
			let current = "create";
			f.setOverride((call) => {
				if (call.init.method === "PATCH" && call.body.body?.toString().includes("updated")) {
					expect(call.body.vector).toBeUndefined();
					current = "patch";
				}
				if (call.init.method === "PUT") current = current === "patch" ? "put" : "final";
				if (call.url.searchParams.has("include") && call.url.pathname.includes(String(ids[0]))) {
					const active =
						stage === "patch"
							? current !== "create"
							: stage === "put"
								? ["put", "final"].includes(current)
								: current === "final";
					return f.json({
						...f.memories[0],
						vector_status: [
							{ profile: "tiny", indexed: true, stale: false, embedding_calls: active ? 1 : 0 },
						],
					});
				}
			});
			const report = await runVectorSmoke(environment, f.dependencies);
			expect(report.ok).toBe(true);
			expect(report.embedding_calls.final).toBe(1);
			expect(report.embedding_call_deltas.final_since_patch).toBe(stage === "patch" ? 0 : 1);
			expect(report.post_patch_attribution).toBe("unverified_body_patch_may_embed");
		},
	);
});
