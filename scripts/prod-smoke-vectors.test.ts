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
type Call = { url: URL; init: RequestInit; body: Record<string, unknown>; time: number };

function fixture(rtt = 1) {
	let time = 0;
	const calls: Call[] = [];
	const memories: Stored[] = [];
	let override: ((call: Call) => Response | undefined) | undefined;
	const json = (value: unknown, status = 200) => Response.json(value, { status });
	const dependencies = {
		now: () => time,
		sleep: async (ms: number) => {
			time += ms;
		},
		fetch: vi.fn(async (url: string, init: RequestInit) => {
			time += rtt;
			const call: Call = {
				url: new URL(url),
				init,
				body: JSON.parse(String(init.body ?? "{}")),
				time,
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
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("prod vector smoke", () => {
	it("runs create, update convergence, zero-embedding checks, and own-ID cleanup", async () => {
		const f = fixture();
		const report = await runVectorSmoke(environment, f.dependencies);
		expect(report.ok).toBe(true);
		expect(report.failures).toEqual([]);
		expect(report.cleanup).toEqual({ attempted: 2, deleted: 2, errors: [] });
		expect(report.embedding_calls).toEqual({
			create: 0,
			noop: 0,
			tags: 0,
			patch: 0,
			put: 0,
			final: 0,
		});
		expect(
			f.calls.filter((call) => call.init.method === "DELETE").map((call) => call.url.pathname),
		).toEqual(ids.map((id) => `/api/v1/memories/${id}`));
		expect(JSON.stringify(report)).not.toContain(KEY);
	});

	it("aggregates multi-run latency summaries and retains failed-run cleanup", async () => {
		const f = fixture(100);
		f.setOverride((call) => {
			if (call.url.pathname.endsWith("/search") && f.memories.length === 2) {
				return f.json({ items: [] });
			}
		});
		const report = await runVectorSmokeBatch(
			{ ...environment, OCTO_SMOKE_RUNS: "2" },
			f.dependencies,
		);
		expect(report.ok).toBe(false);
		expect(report.runs.map((run) => run.ok)).toEqual([false, true]);
		expect(report.runs.map((run) => run.cleanup.deleted)).toEqual([2, 2]);
		expect(report.latencies_ms.create_vector_hit.samples).toBe(1);
		expect(report.latencies_ms.create_indexed.samples).toBe(2);
	});

	it.each([
		{},
		{ ...environment, OCTO_SMOKE_BASE_URL: "http://smoke.example" },
		{ ...environment, OCTO_SMOKE_REQUEST_TIMEOUT_MS: "0" },
	])("rejects invalid environment config before transport calls (%j)", async (env) => {
		const f = fixture();
		const report = await runVectorSmoke(env, f.dependencies);
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([{ phase: "config", code: "invalid_environment" }]);
		expect(f.calls).toHaveLength(0);
	});

	it("rejects invalid run counts, unsafe returned IDs, and sanitizes runtime failures", async () => {
		const badRuns = await runVectorSmokeBatch(
			{ ...environment, OCTO_SMOKE_RUNS: "0" },
			fixture().dependencies,
		);
		expect(badRuns.ok).toBe(false);
		expect(badRuns.failures).toEqual([{ phase: "config", code: "invalid_environment" }]);

		const unsafe = fixture();
		unsafe.setOverride((call) =>
			call.url.pathname.endsWith("/memories")
				? unsafe.json({ id: "../bad", version: 1 })
				: undefined,
		);
		const unsafeReport = await runVectorSmoke(environment, unsafe.dependencies);
		expect(unsafeReport.ok).toBe(false);
		expect(unsafeReport.cleanup.attempted).toBe(0);

		const boom = fixture();
		boom.dependencies.sleep = async () => {
			throw new Error(KEY);
		};
		const boomReport = await runVectorSmoke(environment, boom.dependencies);
		expect(boomReport.ok).toBe(false);
		expect(boomReport.failures).toContainEqual({ phase: "create", code: "runtime_error" });
		expect(JSON.stringify(boomReport)).not.toContain(KEY);
	});

	it("enforces request timeouts and CLI exit codes without leaking secrets", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const origFetch = f.dependencies.fetch;
		f.dependencies.fetch = vi.fn(async (url, init) => {
			if (url.endsWith("/search")) return new Promise<Response>(() => {});
			return origFetch(url, init);
		});
		const timedOutPromise = runVectorSmoke(
			{ ...environment, OCTO_SMOKE_REQUEST_TIMEOUT_MS: "1000" },
			f.dependencies,
		);
		await vi.runAllTimersAsync();
		const timedOut = await timedOutPromise;
		expect(timedOut.ok).toBe(false);
		expect(timedOut.failures).toEqual([{ phase: "create", code: "request_timeout" }]);

		vi.useRealTimers();
		for (const key of Object.keys(environment)) vi.stubEnv(key, "");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await main()).toBe(1);
		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ ok: false });
	});
});
