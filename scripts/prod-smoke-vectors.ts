import { z } from "zod";
import { runIfMain } from "./cli";

const DEADLINE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 2_000;
const MATCH_SIMILARITY = 0.99;
const idSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const versionedSchema = z.object({ id: idSchema, version: z.number().int().positive() });
const statusSchema = versionedSchema.extend({
	vector_status: z.array(
		z.object({
			profile: z.string(),
			indexed: z.boolean(),
			stale: z.boolean(),
			embedding_calls: z.number().int().nonnegative(),
		}),
	),
});
const searchSchema = z.object({
	items: z.array(
		z.object({
			id: idSchema,
			scores: z.object({
				vector: z.object({ similarity: z.number().finite().min(-1).max(1) }).nullable(),
			}),
		}),
	),
});
type Failure = { phase: string; code: string; status?: number };
type CounterStage = "create" | "noop" | "tags" | "patch" | "put" | "final";
type Latency = "create_indexed" | "create_vector_hit" | "update_new_rank1" | "update_old_gone";
type SmokeReport = {
	ok: boolean;
	run: string;
	deadline_ms: number;
	self_match_min_similarity: number;
	old_vector_gone: "memory_id_absent";
	latencies_ms: Record<Latency, number | null>;
	polls: { create: number; update: number };
	duplicate_checks: number;
	embedding_calls: Record<CounterStage, number | null>;
	embedding_call_deltas: { put_since_patch: number | null; final_since_patch: number | null };
	post_patch_attribution: "unverified_body_patch_may_embed";
	failures: Failure[];
	cleanup: { attempted: number; deleted: number; errors: Failure[] };
};
type LatencySummary = { samples: number; p50: number | null; max: number | null };
type SmokeBatchReport = {
	ok: boolean;
	runs: SmokeReport[];
	latencies_ms: Record<Latency, LatencySummary>;
	failures: Failure[];
};
type Dependencies = {
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

class SmokeError extends Error {
	constructor(
		readonly code: string,
		readonly status?: number,
	) {
		super(code);
	}
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) throw new SmokeError("invalid_response");
	return result.data;
}

function failure(phase: string, error: unknown): Failure {
	if (!(error instanceof SmokeError)) return { phase, code: "runtime_error" };
	return error.status === undefined
		? { phase, code: error.code }
		: { phase, code: error.code, status: error.status };
}

function config(environment: Record<string, string | undefined>) {
	const result = z
		.object({
			OCTO_SMOKE_BASE_URL: z.string().regex(/^https?:\/\/[^\s\\/?#]+\/?$/),
			OCTO_SMOKE_API_KEY: z
				.string()
				.min(1)
				.regex(/^[\x21-\x7e]+$/),
			OCTO_SMOKE_SPACE: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
		})
		.safeParse(environment);
	if (!result.success) throw new SmokeError("invalid_environment");
	let base: URL;
	try {
		base = new URL(result.data.OCTO_SMOKE_BASE_URL);
	} catch {
		throw new SmokeError("invalid_environment");
	}
	if (
		base.username ||
		base.password ||
		(base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
	) {
		throw new SmokeError("invalid_environment");
	}
	return {
		origin: base.origin,
		key: result.data.OCTO_SMOKE_API_KEY,
		space: result.data.OCTO_SMOKE_SPACE,
	};
}

export async function runVectorSmoke(
	environment: Record<string, string | undefined> = process.env,
	dependencies: Partial<Dependencies> = {},
): Promise<SmokeReport> {
	const deps: Dependencies = {
		fetch: (url, init) => fetch(url, init),
		now: () => performance.now(),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		...dependencies,
	};
	const report: SmokeReport = {
		ok: false,
		run: `octo-vector-${crypto.randomUUID()}`,
		deadline_ms: DEADLINE_MS,
		self_match_min_similarity: MATCH_SIMILARITY,
		old_vector_gone: "memory_id_absent",
		latencies_ms: {
			create_indexed: null,
			create_vector_hit: null,
			update_new_rank1: null,
			update_old_gone: null,
		},
		polls: { create: 0, update: 0 },
		duplicate_checks: 0,
		embedding_calls: { create: null, noop: null, tags: null, patch: null, put: null, final: null },
		embedding_call_deltas: { put_since_patch: null, final_since_patch: null },
		post_patch_attribution: "unverified_body_patch_may_embed",
		failures: [],
		cleanup: { attempted: 0, deleted: 0, errors: [] },
	};
	let settings: ReturnType<typeof config>;
	try {
		settings = config(environment);
	} catch {
		report.failures.push({ phase: "config", code: "invalid_environment" });
		return report;
	}
	const created = new Set<string>();
	let phase = "setup";
	const record = (code: string) => {
		if (!report.failures.some((issue) => issue.phase === phase && issue.code === code)) {
			report.failures.push({ phase, code });
		}
	};
	async function request(
		path: string,
		method = "GET",
		body?: unknown,
		budget = REQUEST_TIMEOUT_MS,
	): Promise<unknown> {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(
				() => {
					controller.abort();
					reject(new SmokeError("request_timeout"));
				},
				Math.max(1, Math.ceil(Math.min(REQUEST_TIMEOUT_MS, budget))),
			);
		});
		try {
			return await Promise.race([
				(async () => {
					const response = await deps.fetch(`${settings.origin}/api/v1${path}`, {
						method,
						headers: {
							authorization: `Bearer ${settings.key}`,
							"content-type": "application/json",
						},
						redirect: "error",
						signal: controller.signal,
						...(body === undefined ? {} : { body: JSON.stringify(body) }),
					});
					if (!response.ok) throw new SmokeError("http_error", response.status);
					try {
						return await response.json();
					} catch {
						throw new SmokeError("invalid_response");
					}
				})(),
				timeout,
			]);
		} catch (error) {
			throw error instanceof SmokeError ? error : new SmokeError("request_failed");
		} finally {
			clearTimeout(timer);
		}
	}
	try {
		const space = parse(
			z.object({ slug: z.literal(settings.space) }),
			await request(`/spaces/${settings.space}`),
		);
		const profiles = parse(
			z.object({
				active_profile: z.string(),
				items: z.array(
					z.object({
						id: z.string().min(1).max(64),
						dims: z.number().int().min(2).max(1536),
						metric: z.string(),
					}),
				),
			}),
			await request("/embedding-profiles"),
		);
		const selected = profiles.items.find((item) => item.id === profiles.active_profile);
		if (selected?.metric !== "cosine") throw new SmokeError("unsupported_profile");
		const profile = selected;
		const vector = (first: number, second: number) => ({
			profile: profile.id,
			values: Array.from({ length: profile.dims }, (_, i) =>
				i === 0 ? first : i === 1 ? second : 0,
			),
		});
		const oldVector = vector(1, 0);
		const newVector = vector(0, 1);
		const initialBody = `${report.run} initial body`;
		async function create(label: string, supplied: ReturnType<typeof vector>) {
			const response = await request("/memories", "POST", {
				space: space.slug,
				title: `${report.run} ${label}`,
				body: label === "target" ? initialBody : `${report.run} control body`,
				type: "note",
				tags: [report.run],
				vector: supplied,
			});
			const { id } = parse(z.object({ id: idSchema }), response);
			if (created.has(id)) throw new SmokeError("duplicate_created_id");
			created.add(id);
			return parse(versionedSchema, response);
		}
		async function read(
			id: string,
			stage: CounterStage,
			budget = REQUEST_TIMEOUT_MS,
			requireZero = ["create", "noop", "tags"].includes(stage),
		) {
			const item = parse(
				statusSchema,
				await request(`/memories/${id}?include=vector_status`, "GET", undefined, budget),
			);
			if (item.id !== id) throw new SmokeError("unexpected_memory_id");
			const statuses = item.vector_status.filter((item) => item.profile === profile.id);
			if (statuses.length !== 1) throw new SmokeError("missing_vector_status");
			const status = statuses[0];
			if (!status) throw new SmokeError("missing_vector_status");
			report.embedding_calls[stage] = Math.max(
				report.embedding_calls[stage] ?? 0,
				status.embedding_calls,
			);
			if (requireZero && status.embedding_calls !== 0) record("embedding_calls_nonzero");
			return { ...item, status };
		}
		async function search(
			supplied: ReturnType<typeof vector>,
			mode: "vector" | "hybrid",
			budget: number,
		) {
			const response = parse(
				searchSchema,
				await request(
					"/search",
					"POST",
					{
						...(mode === "hybrid" ? { query: report.run } : {}),
						vector: supplied,
						mode,
						filters: { spaces: [space.slug], tags_all: [report.run] },
						limit: 100,
					},
					budget,
				),
			);
			report.duplicate_checks += 1;
			if (new Set(response.items.map((item) => item.id)).size !== response.items.length)
				record("duplicate_memory_ids");
			return response.items;
		}
		async function mutate(
			item: z.infer<typeof versionedSchema>,
			body: Record<string, unknown>,
			method: "PATCH" | "PUT" = "PATCH",
		) {
			const updated = parse(
				versionedSchema,
				await request(`/memories/${item.id}${method === "PUT" ? "/vector" : ""}`, method, {
					...body,
					expected_version: item.version,
				}),
			);
			if (updated.id !== item.id) throw new SmokeError("unexpected_memory_id");
			return updated;
		}
		phase = "create";
		let target = await create("target", oldVector);
		const createStart = deps.now();
		const control = await create("control", vector(0.6, 0.8));
		async function observe(stage: "create" | "update", start: number) {
			phase = stage;
			const deadline = start + DEADLINE_MS;
			const fields: Latency[] =
				stage === "create"
					? ["create_indexed", "create_vector_hit"]
					: ["update_new_rank1", "update_old_gone"];
			const mark = (field: Latency, ready: boolean) => {
				const elapsed = deps.now() - start;
				if (elapsed >= DEADLINE_MS) return;
				if (ready && report.latencies_ms[field] === null) report.latencies_ms[field] = elapsed;
				if (!ready && report.latencies_ms[field] !== null) record("convergence_regressed");
			};
			let indexed = false;
			let vectorRank1 = false;
			let hybridRank1 = false;
			const near = (item: z.infer<typeof searchSchema>["items"][number]) =>
				(item.scores.vector?.similarity ?? -1) >= MATCH_SIMILARITY;
			const supplied = stage === "create" ? oldVector : newVector;
			const steps = [
				async (budget: number) => {
					const current = await read(
						target.id,
						stage === "create" ? "create" : report.polls.update === 0 ? "put" : "final",
						budget,
					);
					indexed = current.status.indexed && !current.status.stale;
					if (stage === "create") mark("create_indexed", indexed);
				},
				async (budget: number) => {
					const hits = await search(supplied, "vector", budget);
					if (stage === "create") {
						mark(
							"create_vector_hit",
							hits.some((item) => item.id === target.id && near(item)),
						);
					} else {
						vectorRank1 = hits[0]?.id === target.id && near(hits[0]);
					}
				},
				async (budget: number) => {
					const hits = await search(supplied, "hybrid", budget);
					hybridRank1 = hits[0]?.id === target.id && near(hits[0]);
				},
			];
			if (stage === "update") {
				steps.push(
					async (budget: number) => {
						const hits = await search(oldVector, "vector", budget);
						mark("update_old_gone", !hits.some((item) => item.id === target.id));
					},
					async (budget: number) => {
						await search(oldVector, "hybrid", budget);
					},
				);
			}
			while (true) {
				const budget = deadline - deps.now();
				if (budget <= 0) break;
				try {
					await steps[report.polls[stage] % steps.length]?.(budget);
					if (stage === "update") mark("update_new_rank1", indexed && vectorRank1 && hybridRank1);
					report.polls[stage] += 1;
				} catch (error) {
					if (
						error instanceof SmokeError &&
						error.code === "request_timeout" &&
						(budget <= REQUEST_TIMEOUT_MS || deps.now() >= deadline)
					)
						break;
					throw error;
				}
				await deps.sleep(Math.min(250, Math.max(0, deadline - deps.now())));
			}
			if (fields.some((field) => report.latencies_ms[field] === null)) record("deadline_exceeded");
		}
		await observe("create", createStart);
		await read(control.id, "create");
		phase = "noop";
		const noop = await mutate(target, { body: initialBody });
		if (noop.version !== target.version) record("noop_changed_version");
		target = noop;
		await read(target.id, "noop");
		phase = "tags";
		target = await mutate(target, { tags: [report.run, `${report.run}-tags`] });
		await read(target.id, "tags");
		phase = "update";
		target = await mutate(target, { body: `${report.run} updated body` });
		await read(target.id, "patch");
		target = await mutate(target, newVector, "PUT");
		const updateStart = deps.now();
		await observe("update", updateStart);
		phase = "put_noop";
		const sameVector = await mutate(target, newVector, "PUT");
		if (sameVector.version !== target.version) record("noop_changed_version");
		await read(target.id, "final");
		await read(control.id, "final", REQUEST_TIMEOUT_MS, true);
	} catch (error) {
		report.failures.push(failure(phase, error));
	} finally {
		for (const id of created) {
			report.cleanup.attempted += 1;
			try {
				await request(`/memories/${id}`, "DELETE");
				report.cleanup.deleted += 1;
			} catch (error) {
				report.cleanup.errors.push(failure("cleanup", error));
			}
		}
	}
	const counters = report.embedding_calls;
	if (counters.patch !== null) {
		if (counters.put !== null)
			report.embedding_call_deltas.put_since_patch = counters.put - counters.patch;
		if (counters.final !== null)
			report.embedding_call_deltas.final_since_patch = counters.final - counters.patch;
	}
	report.ok = report.failures.length === 0 && report.cleanup.errors.length === 0;
	return report;
}

export async function runVectorSmokeBatch(
	environment: Record<string, string | undefined> = process.env,
	dependencies: Partial<Dependencies> = {},
): Promise<SmokeBatchReport> {
	const count = z
		.string()
		.regex(/^[1-9][0-9]*$/)
		.default("1")
		.pipe(z.coerce.number<string>().int().positive())
		.safeParse(environment.OCTO_SMOKE_RUNS);
	const runs: SmokeReport[] = [];
	const failures: Failure[] = [];
	if (count.success) {
		for (let run = 0; run < count.data; run += 1) {
			runs.push(await runVectorSmoke(environment, dependencies));
		}
	} else {
		failures.push({ phase: "config", code: "invalid_environment" });
	}
	const summarize = (metric: Latency): LatencySummary => {
		const values = runs
			.map((run) => run.latencies_ms[metric])
			.filter((latency) => latency !== null)
			.sort((left, right) => left - right);
		const middle = values.slice(
			Math.floor((values.length - 1) / 2),
			Math.floor(values.length / 2) + 1,
		);
		return {
			samples: values.length,
			p50:
				middle.length === 0 ? null : middle.reduce((sum, value) => sum + value, 0) / middle.length,
			max: values.at(-1) ?? null,
		};
	};
	return {
		ok: failures.length === 0 && runs.every((run) => run.ok),
		runs,
		latencies_ms: {
			create_indexed: summarize("create_indexed"),
			create_vector_hit: summarize("create_vector_hit"),
			update_new_rank1: summarize("update_new_rank1"),
			update_old_gone: summarize("update_old_gone"),
		},
		failures,
	};
}

export async function main(): Promise<number> {
	try {
		const report = await runVectorSmokeBatch();
		console.log(JSON.stringify(report));
		return report.ok ? 0 : 1;
	} catch {
		console.log(
			JSON.stringify({ ok: false, failures: [{ phase: "runtime", code: "runtime_error" }] }),
		);
		return 1;
	}
}

await runIfMain(import.meta, main);
