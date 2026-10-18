import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
import { arch, cpus, freemem, loadavg, platform, release, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Miniflare } from "miniflare";
import {
	assertCrossIcuSample,
	type CorpusRow,
	CROSS_ICU,
	corpusRow,
	seedWordFields,
	sourceManifest,
	summarize,
	TOPICS,
} from "./word-search-lib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rows = Number(process.env.BENCH_ROWS ?? 50_000);
const warmups = Number(process.env.BENCH_WARMUPS ?? 5);
const samples = Number(process.env.BENCH_SAMPLES ?? 30);
const batchRows = 20;
const seedBatchRows = 200;
const candidateK = 50;
const spaceId = "bench-space";
const actor = "bench-actor";
const startedAt = new Date().toISOString();
const markerSql = "SELECT value FROM _test_marker WHERE key = 'env'";
type Runtime = typeof import("./word-search-runtime");
type Lane = { name: "trigram" | "trigram_words"; db: D1Database; words: boolean };
type Timed = {
	wall_ms: number;
	d1_ms: number;
	statement_count: number;
	rows_read: number;
	rows_written: number;
};
type SqlTrace = {
	sql: string;
	duration_ms: number;
	wall_ms: number;
	rows_read: number;
	rows_written: number;
	result_rows: number;
};

function sha256(text: string | Uint8Array) {
	return createHash("sha256").update(text).digest("hex");
}

function git(...args: string[]) {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function machine() {
	return {
		at: new Date().toISOString(),
		load_average_1_5_15: loadavg(),
		free_memory_bytes: freemem(),
		process_cpu_usage: process.cpuUsage(),
		process_memory: process.memoryUsage(),
		top_cpu_processes: execFileSync("ps", ["-A", "-o", "pid=,pcpu=,pmem=,comm="], {
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.sort(
				(leftProcess, rightProcess) =>
					Number(rightProcess.trim().split(/\s+/)[1]) - Number(leftProcess.trim().split(/\s+/)[1]),
			)
			.slice(0, 12),
	};
}

async function assertMarker(db: D1Database) {
	if ((await db.prepare(markerSql).first<{ value: string }>())?.value !== "test") {
		throw new Error("refusing benchmark mutation without _test_marker env=test");
	}
}

async function assertIsolated(path: string) {
	if (relative(root, path).split("/").slice(0, 2).join("/") !== ".wrangler/bench-word") {
		throw new Error("benchmark persistence outside its reserved directory");
	}
	for (let current = path; current !== root; current = dirname(current)) {
		if ((await lstat(current)).isSymbolicLink())
			throw new Error("symlink in benchmark persistence");
	}
	if ((await realpath(path)) !== path) throw new Error("noncanonical benchmark persistence");
}

function summarizeTiming(measurements: Timed[]) {
	return {
		wall_ms: summarize(measurements.map((sample) => sample.wall_ms)),
		d1_ms: summarize(measurements.map((sample) => sample.d1_ms)),
	};
}

async function timedBatch(db: D1Database, statements: D1PreparedStatement[]): Promise<Timed> {
	const start = performance.now();
	const results = await db.batch(statements);
	const wall_ms = performance.now() - start;
	if (results.some((result) => !result.success)) throw new Error("D1 batch failure");
	return {
		wall_ms,
		d1_ms: results.reduce((sum, result) => sum + result.meta.duration, 0),
		statement_count: statements.length,
		rows_read: results.reduce((sum, result) => sum + result.meta.rows_read, 0),
		rows_written: results.reduce((sum, result) => sum + result.meta.rows_written, 0),
	};
}

function tracedDatabase(db: D1Database, traces: SqlTrace[]): D1Database {
	function wrap(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
		return new Proxy(statement, {
			get(target, property) {
				if (property === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
				if (property === "all")
					return async () => {
						const start = performance.now();
						const result = await target.all();
						traces.push({
							sql,
							duration_ms: result.meta.duration,
							wall_ms: performance.now() - start,
							rows_read: result.meta.rows_read,
							rows_written: result.meta.rows_written,
							result_rows: result.results.length,
						});
						return result;
					};
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}
	return new Proxy(db, {
		get(target, property) {
			if (property === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

async function freezeRuntime(runPath: string) {
	const files = execFileSync(
		"fd",
		[
			"-t",
			"f",
			"-e",
			"ts",
			"-e",
			"sql",
			".",
			"apps/web/src/server",
			"apps/web/src/lib",
			"migrations",
			"benchmarks",
		],
		{ cwd: root, encoding: "utf8" },
	)
		.trim()
		.split("\n")
		.filter((file) => !file.endsWith(".test.ts"));
	const hashes: Record<string, string> = {};
	for (const file of files) {
		const contents = await readFile(join(root, file));
		hashes[file] = sha256(contents);
		await mkdir(dirname(join(runPath, "source", file)), { recursive: true });
		await writeFile(join(runPath, "source", file), contents);
	}
	const build = await Bun.build({
		entrypoints: [join(root, "benchmarks/word-search-runtime.ts")],
		target: "bun",
		format: "esm",
		sourcemap: "inline",
	});
	const output = build.outputs[0];
	if (!build.success || !output)
		throw new AggregateError(build.logs, "benchmark runtime bundle failed");
	for (const file of files) {
		if (sha256(await readFile(join(root, file))) !== hashes[file]) {
			throw new Error(`source changed while freezing benchmark runtime: ${file}; rerun`);
		}
	}
	const bundlePath = join(runPath, "runtime.mjs");
	const bundle = await output.text();
	await writeFile(bundlePath, bundle);
	return {
		runtime: (await import(pathToFileURL(bundlePath).href)) as Runtime,
		source: {
			head: git("rev-parse", "HEAD"),
			dirty_scope: git("status", "--short"),
			hashes: sourceManifest(hashes),
			bundle_path: bundlePath,
			bundle_sha256: sha256(bundle),
		},
	};
}

async function migrate(lane: Lane, runPath: string, runtime: Runtime) {
	await lane.db
		.prepare("CREATE TABLE _test_marker (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
		.run();
	await lane.db.prepare("INSERT INTO _test_marker VALUES ('env', 'test')").run();
	await assertMarker(lane.db);
	const { unstable_splitSqlQuery } = await import("wrangler");
	const directory = join(runPath, "source/migrations");
	const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
	for (const migration of migrations) {
		await assertMarker(lane.db);
		const sql = await readFile(join(directory, migration), "utf8");
		await lane.db.batch(unstable_splitSqlQuery(sql).map((statement) => lane.db.prepare(statement)));
	}
	await assertMarker(lane.db);
	await lane.db
		.prepare("INSERT INTO spaces (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
		.bind(spaceId, spaceId, "Benchmark only")
		.run();
	for (const [index, topic] of TOPICS.entries()) {
		const name = `${topic[0]} ${topic[1]}`;
		await lane.db
			.prepare(
				"INSERT INTO tags (id, name, display_name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
			)
			.bind(`tag-${index}`, name, name)
			.run();
		if (lane.words)
			await lane.db
				.prepare("INSERT INTO search_tag_tokens (tag_id, name, tokens) VALUES (?, ?, ?)")
				.bind(`tag-${index}`, name, runtime.indexText(name))
				.run();
	}
	return migrations;
}

function seedStatements(
	lane: Lane,
	records: Array<
		CorpusRow & { hash: string; word_title: string; word_body: string; word_tags: string }
	>,
) {
	const json = JSON.stringify(records);
	const queries = [
		`INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, updated_by_key_id, content_hash, created_at, updated_at)
SELECT json_extract(value, '$.id'), '${spaceId}', json_extract(value, '$.title'), json_extract(value, '$.body'), 'note', 0.5, '${actor}', '${actor}', json_extract(value, '$.hash'), json_extract(value, '$.updated_at'), json_extract(value, '$.updated_at') FROM json_each(?)`,
		`INSERT INTO memory_versions (memory_id, version, title, body, type, importance, tags_json, space_id, actor, op, created_at)
SELECT json_extract(value, '$.id'), 1, json_extract(value, '$.title'), json_extract(value, '$.body'), 'note', 0.5, json_array(json_extract(value, '$.tag')), '${spaceId}', '${actor}', 'create', json_extract(value, '$.updated_at') FROM json_each(?)`,
		"INSERT INTO memory_tags (memory_id, tag_id, position) SELECT json_extract(value, '$.id'), json_extract(value, '$.tag_id'), 0 FROM json_each(?)",
		"INSERT INTO memories_fts_map (memory_id, fts_rowid) SELECT json_extract(value, '$.id'), json_extract(value, '$.rowid') FROM json_each(?)",
		"INSERT INTO memories_fts (rowid, title, body, tags) SELECT json_extract(value, '$.rowid'), json_extract(value, '$.title'), json_extract(value, '$.body'), json_extract(value, '$.tag') FROM json_each(?)",
		`INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) SELECT 'memory', json_extract(value, '$.id'), '${spaceId}', 'created', 1, '${actor}', json_extract(value, '$.updated_at') FROM json_each(?)`,
	];
	if (lane.words)
		queries.push(
			"INSERT INTO memories_words_fts (rowid, title, body, tags) SELECT json_extract(value, '$.rowid'), json_extract(value, '$.word_title'), json_extract(value, '$.word_body'), json_extract(value, '$.word_tags') FROM json_each(?)",
		);
	return queries.map((sql) => lane.db.prepare(sql).bind(json));
}

function createStatements(lane: Lane, record: CorpusRow, hash: string, runtime: Runtime) {
	const { db } = lane;
	const statements = [
		db
			.prepare(
				"INSERT INTO memories (id, space_id, title, body, type, importance, source_key_id, updated_by_key_id, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'note', 0.5, ?, ?, ?, ?, ?)",
			)
			.bind(
				record.id,
				spaceId,
				record.title,
				record.body,
				actor,
				actor,
				hash,
				record.updated_at,
				record.updated_at,
			),
		db
			.prepare(
				"INSERT INTO memory_versions (memory_id, version, title, body, type, importance, tags_json, space_id, actor, op, created_at) VALUES (?, 1, ?, ?, 'note', 0.5, ?, ?, ?, 'create', ?)",
			)
			.bind(
				record.id,
				record.title,
				record.body,
				JSON.stringify([record.tag]),
				spaceId,
				actor,
				record.updated_at,
			),
		db
			.prepare("INSERT INTO memory_tags (memory_id, tag_id, position) VALUES (?, ?, 0)")
			.bind(record.id, record.tag_id),
		db
			.prepare("INSERT INTO memories_fts_map (memory_id, fts_rowid) VALUES (?, ?)")
			.bind(record.id, record.rowid),
		db
			.prepare("INSERT INTO memories_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)")
			.bind(record.rowid, record.title, record.body, record.tag),
		db
			.prepare(
				"INSERT INTO changes (entity, entity_id, space_id, op, version, actor, at) VALUES ('memory', ?, ?, 'created', 1, ?, ?)",
			)
			.bind(record.id, spaceId, actor, record.updated_at),
	];
	if (lane.words) statements.push(...runtime.wordIndexStatements(db, { ...record, version: 1 }));
	return statements;
}

async function querySample(db: D1Database, runtime: Runtime, query: string) {
	const traces: SqlTrace[] = [];
	const instrumented = tracedDatabase(db, traces);
	const start = performance.now();
	const result = await runtime.runFtsChannel(instrumented, query, [spaceId], undefined, candidateK);
	return {
		wall_ms: performance.now() - start,
		d1_ms: traces.reduce((sum, trace) => sum + trace.duration_ms, 0),
		statement_count: traces.length,
		rows_read: traces.reduce((sum, trace) => sum + trace.rows_read, 0),
		rows_written: traces.reduce((sum, trace) => sum + trace.rows_written, 0),
		hits: result.hits.length,
		first_id: result.hits[0]?.id ?? null,
		partial: result.partial,
		traces,
	};
}

async function crossIcuFixtureEvidence(db: D1Database, runtime: Runtime) {
	const target = corpusRow(CROSS_ICU.targetIndex);
	const terms = runtime.tokenizeQuery(CROSS_ICU.query);
	if (terms.length !== 1 || terms[0] !== CROSS_ICU.query) {
		throw new Error("cross-ICU query must be one two-Han compound token");
	}
	const exactMatch = `"${CROSS_ICU.query}"`;
	const unigramMatch = [...CROSS_ICU.query].map((character) => `"${character}"`).join(" AND ");
	const exactWordHits = Number(
		await db
			.prepare("SELECT COUNT(*) AS n FROM memories_words_fts WHERE memories_words_fts MATCH ?")
			.bind(exactMatch)
			.first("n"),
	);
	const coarseHits = Number(
		await db
			.prepare("SELECT COUNT(*) AS n FROM memories_words_fts WHERE memories_words_fts MATCH ?")
			.bind(unigramMatch)
			.first("n"),
	);
	const coarseTop = await db
		.prepare(`
SELECT m.id, bm25(memories_words_fts, 5.0, 1.0, 2.0) AS score
FROM memories_words_fts
JOIN memories_fts_map map ON map.fts_rowid = memories_words_fts.rowid
JOIN memories m ON m.id = map.memory_id
WHERE memories_words_fts MATCH ? AND m.deleted_at IS NULL AND m.space_id = ?
ORDER BY score, m.id LIMIT ?`)
		.bind(unigramMatch, spaceId, candidateK)
		.all<{ id: string; score: number }>();
	const newer = Number(
		await db
			.prepare("SELECT COUNT(*) AS n FROM memories WHERE space_id = ? AND updated_at > ?")
			.bind(spaceId, target.updated_at)
			.first("n"),
	);
	if (
		exactWordHits !== 0 ||
		coarseHits <= candidateK ||
		coarseTop.results.length !== candidateK ||
		coarseTop.results.some((hit) => hit.id === target.id) ||
		newer <= 500
	) {
		throw new Error("cross-ICU fixture must exclude the old target from the unverified top-K");
	}
	return {
		query: CROSS_ICU.query,
		terms,
		target_id: target.id,
		newer_records: newer,
		exact_word_hits: exactWordHits,
		unigram_candidates: coarseHits,
		unverified_top_k: coarseTop.results,
		target_outside_unverified_top_k: true,
		forced_seed_tokenization:
			"Remove only the standalone compound token from the target's seeded word fields; preserve original text, production unigram tokens and all other words.",
	};
}

async function storage(lane: Lane, expectedRows: number) {
	const rowcounts: Record<string, number> = {};
	const tables = await lane.db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
		.all<{ name: string }>();
	for (const { name } of tables.results) {
		if (name.startsWith("_cf_")) continue;
		rowcounts[name] = Number(
			await lane.db.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).first("n"),
		);
	}
	for (const table of [
		"memories",
		"memory_versions",
		"memory_tags",
		"memories_fts_map",
		"memories_fts",
		"changes",
	]) {
		if (rowcounts[table] !== expectedRows)
			throw new Error(`unexpected ${lane.name}.${table} rowcount`);
	}
	if (rowcounts.memories_words_fts !== (lane.words ? expectedRows : 0)) {
		throw new Error(`unexpected ${lane.name} word-index rowcount`);
	}
	const database_bytes = tables.meta.size_after;
	let physical: unknown;
	try {
		physical = (
			await lane.db
				.prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY name")
				.all()
		).results;
	} catch (error) {
		physical = { unavailable: String(error) };
	}
	const index_payload_bytes: Record<string, unknown> = {};
	for (const table of ["memories_fts", "memories_words_fts"]) {
		const data = Number(
			await lane.db
				.prepare(`SELECT COALESCE(SUM(length(block)), 0) AS n FROM ${table}_data`)
				.first("n"),
		);
		const docsize = Number(
			await lane.db
				.prepare(`SELECT COALESCE(SUM(length(sz)), 0) AS n FROM ${table}_docsize`)
				.first("n"),
		);
		const terms = Number(
			await lane.db
				.prepare(`SELECT COALESCE(SUM(length(CAST(term AS BLOB))), 0) AS n FROM ${table}_idx`)
				.first("n"),
		);
		const content =
			table === "memories_words_fts"
				? Number(
						await lane.db
							.prepare(
								`SELECT COALESCE(SUM(length(CAST(c0 AS BLOB)) + length(CAST(c1 AS BLOB)) + length(CAST(c2 AS BLOB))), 0) AS n FROM ${table}_content`,
							)
							.first("n"),
					)
				: 0;
		index_payload_bytes[table] = {
			postings_data: data,
			docsize,
			index_terms: terms,
			stored_content: content,
			total: data + docsize + terms + content,
		};
	}
	const unmatched = Number(
		await lane.db
			.prepare(
				"SELECT COUNT(*) AS n FROM memories_words_fts w LEFT JOIN memories_fts_map m ON m.fts_rowid = w.rowid WHERE m.memory_id IS NULL",
			)
			.first("n"),
	);
	if (unmatched !== 0) throw new Error("word index rowid mapping mismatch");
	return {
		rowcounts,
		database_bytes,
		database_bytes_source: "D1 result.meta.size_after (workerd SQL databaseSize)",
		index_payload_bytes,
		dbstat: physical,
		unmapped_words: unmatched,
	};
}

async function physicalFiles(runPath: string) {
	const files = execFileSync(
		"fd",
		["--hidden", "--no-ignore", "-t", "f", "\\.sqlite(?:-wal|-shm)?$", runPath],
		{ encoding: "utf8" },
	)
		.trim()
		.split("\n")
		.filter(Boolean);
	const result = [];
	for (const file of files) {
		const entry: Record<string, unknown> = { path: file, bytes: (await stat(file)).size };
		if (file.endsWith(".sqlite") && !file.endsWith("/metadata.sqlite")) {
			const db = new Database(file, { readonly: true });
			try {
				const marker = db.query(markerSql).get() as { value: string } | null;
				if (marker?.value === "test") {
					entry.test_marker = marker.value;
					entry.page_count = db.query("PRAGMA page_count").get();
					entry.page_size = db.query("PRAGMA page_size").get();
					entry.freelist_count = db.query("PRAGMA freelist_count").get();
					entry.word_rows = (
						db.query("SELECT COUNT(*) AS n FROM memories_words_fts").get() as { n: number }
					).n;
					entry.dbstat = db
						.query("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY name")
						.all();
				}
			} catch (error) {
				entry.inspection_error = String(error);
			} finally {
				db.close();
			}
		}
		result.push(entry);
	}
	return result;
}

async function main() {
	if (
		!Number.isInteger(rows) ||
		rows < 1_000 ||
		!Number.isInteger(samples) ||
		samples < 30 ||
		!Number.isInteger(warmups) ||
		warmups < 5
	) {
		throw new Error("BENCH_ROWS must be >=1000; BENCH_SAMPLES >=30; BENCH_WARMUPS >=5");
	}
	const parent = join(root, ".wrangler/bench-word");
	await mkdir(parent, { recursive: true });
	const runPath = await mkdtemp(join(parent, `${startedAt.replaceAll(/[:.]/g, "-")}-`));
	await assertIsolated(runPath);
	const runId = relative(parent, runPath);
	const resultPath = join(root, "benchmarks/results", `${runId}.json`);
	await mkdir(dirname(resultPath), { recursive: true });
	const report: Record<string, unknown> = {
		status: "running",
		run_id: runId,
		started_at: startedAt,
		persistence_path: runPath,
		result_path: resultPath,
		command: `BENCH_ROWS=${rows} BENCH_WARMUPS=${warmups} BENCH_SAMPLES=${samples} bun benchmarks/word-search.ts`,
		parameters: {
			rows,
			warmups,
			samples,
			batch_rows: batchRows,
			seed_batch_rows: seedBatchRows,
			candidate_k: candidateK,
			cross_icu_fixture: CROSS_ICU,
			compatibility_date: "2026-04-01",
		},
		environment: {
			bun: Bun.version,
			node: process.version,
			platform: platform(),
			release: release(),
			architecture: arch(),
			cpu: cpus()[0]?.model,
			logical_cpus: cpus().length,
			total_memory_bytes: totalmem(),
			icu: process.versions.icu,
			miniflare: JSON.parse(
				await readFile(join(root, "node_modules/miniflare/package.json"), "utf8"),
			).version,
		},
		methodology: {
			isolation:
				"Direct Miniflare getD1Database; no Wrangler CLI/getPlatformProxy; no remote bindings, CF lookup, telemetry, registration, R2, assets, fixed ports, or production configuration. Separate benchmark-only D1 IDs under a freshly created local run directory. Marker created and verified before migrations/fixtures and before each mutation phase. Persistence retained, never cleaned automatically.",
			corpus:
				"Deterministic 10-topic Chinese/Latin notes; oldest coffee sentinel plus one archived compound target and 100 separated-character distractors. Only the compound target's seeded word fields omit its standalone compound token, simulating alternate ICU word boundaries while preserving real indexText unigrams and original fields. All other seed tokens use production indexText unchanged. Same original records in both lanes; preexisting tags, versions, maps, changes and vector-sync triggers retained. Synthetic cohort changes 101 seed rows versus earlier runs; measured write workload is unchanged.",
			queries:
				"Frozen actual runFtsChannel/tokenizer; candidateK=50, no extra filters. Measure two-character, multi-term and forced cross-ICU two-Han fallback queries. Alternate query order each round; >=5 warmups and >=30 measured samples each. Fallback fixture checks outside timing prove zero exact word hits and target outside unverified top-K; every fallback sample must execute empty direct MATCH then contiguous original-field verification before LIMIT and return only the target. Wall includes Bun segmentation, proxy/IPC and result mapping. D1 milliseconds sum all statement meta.duration; raw SQL and returned-row counts retained. No HTTP/auth/vector/embedding timings.",
			writes:
				"Paired alternating old/new lanes insert the same 20 new memories in one atomic D1 batch each round, after the 50k-row query run. Same row/version/tag/map/trigram/change statements; new lane additionally uses real wordIndexStatements (including Intl.Segmenter indexText and guarded DELETE/INSERT) per row. Corpus generation and SHA-256 occur before timing. Preparation includes binding and real segmentation; batch wall measures await db.batch only; end-to-end is their sum. Existing tag tokens are prepared during setup, not timed. This is a controlled insert workload, not the complete MemoryRepo/API request path. No updates/deletes/backfill throughput claim.",
			size: "D1 result.meta.size_after reports workerd SQL databaseSize, not billing size. Index payload sums data/docsize/term/content bytes, excluding b-tree cell/header overhead. dbstat is attempted through D1 and read-only persisted SQLite after disposal for exact per-table allocated pages. SQLite page count/size/freelist and disk files/WAL measured only after runtime disposal because D1 denies these PRAGMAs. Natural FTS merges; no optimize or vacuum. Reserved _cf_ metadata tables are excluded from D1 rowcounts.",
			load: "Single benchmark process, no simultaneous benchmark queries/writes; machine background load is not controlled. Load averages, process CPU/memory and top CPU processes sampled at phase boundaries. Not production latency or an unloaded-machine SLA.",
		},
		load: [machine()],
	};
	const save = () => writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`);
	await save();
	let miniflare: Miniflare | undefined;
	try {
		const frozen = await freezeRuntime(runPath);
		const { runtime } = frozen;
		report.source_start = frozen.source;
		miniflare = new Miniflare({
			host: "127.0.0.1",
			port: 0,
			cf: false,
			telemetry: { enabled: false },
			resourcePersistencePath: join(runPath, "v3"),
			workers: [
				{
					config: {
						name: "octo-word-benchmark",
						compatibilityDate: "2026-04-01",
						manifest: {
							mainModule: "worker.mjs",
							modules: {
								"worker.mjs": {
									type: "esm",
									contents:
										"export default { fetch() { return new Response('local benchmark only') } }",
								},
							},
						},
						env: {
							OLD: { type: "d1", id: `bench-old-${runId}` },
							WORDS: { type: "d1", id: `bench-words-${runId}` },
						},
					},
					dev: { unsafeRegisterWorker: false },
				},
			],
		});
		const listener = await miniflare.ready;
		if (listener.hostname !== "127.0.0.1" || !listener.port) throw new Error("unexpected listener");
		report.listener = listener.href;
		const lanes: Lane[] = [
			{
				name: "trigram",
				db: (await miniflare.getD1Database("OLD")) as unknown as D1Database,
				words: false,
			},
			{
				name: "trigram_words",
				db: (await miniflare.getD1Database("WORDS")) as unknown as D1Database,
				words: true,
			},
		];
		for (const lane of lanes) report.migrations = await migrate(lane, runPath, runtime);
		console.log(`本地基准 ${runId}: 开始装载 ${rows} 条记录 / 数据库`);
		const seedStart = performance.now();
		let segmentationMs = 0;
		let textBytes = 0;
		const seedTimings: Record<string, Timed[]> = { trigram: [], trigram_words: [] };
		for (let offset = 0; offset < rows; offset += seedBatchRows) {
			const records = Array.from({ length: Math.min(seedBatchRows, rows - offset) }, (_, index) => {
				const row = corpusRow(offset + index);
				textBytes += Buffer.byteLength(row.title + row.body + row.tag);
				const start = performance.now();
				const tokenized = seedWordFields(row, runtime.indexText);
				segmentationMs += performance.now() - start;
				return { ...row, hash: sha256(row.title + row.body), ...tokenized };
			});
			for (const lane of (offset / seedBatchRows) % 2 ? [...lanes].reverse() : lanes) {
				await assertMarker(lane.db);
				seedTimings[lane.name]?.push(await timedBatch(lane.db, seedStatements(lane, records)));
			}
			if ((offset + records.length) % 5_000 === 0 || offset + records.length === rows)
				console.log(`已装载 ${offset + records.length}/${rows}`);
		}
		report.seed = {
			wall_ms: performance.now() - seedStart,
			segmentation_ms: segmentationMs,
			text_utf8_bytes: textBytes,
			timings: seedTimings,
		};
		(report.load as unknown[]).push(machine());
		report.storage_before_writes = Object.fromEntries(
			await Promise.all(lanes.map(async (lane) => [lane.name, await storage(lane, rows)])),
		);
		await save();
		const words = lanes[1] as Lane;
		report.cross_icu_fixture = await crossIcuFixtureEvidence(words.db, runtime);
		await save();
		const queryCases = [
			{ name: "two_character", query: "备份" },
			{ name: "multi_term", query: "项目 migration 发布" },
			{ name: "cross_icu_fallback", query: CROSS_ICU.query },
		];
		const queryRaw: Record<string, Awaited<ReturnType<typeof querySample>>[]> = {};
		const queryWarmups: typeof queryRaw = {};
		for (const test of queryCases) {
			queryRaw[test.name] = [];
			queryWarmups[test.name] = [];
		}
		console.log("开始查询采样");
		for (let round = 0; round < warmups + samples; round++) {
			for (const test of round % 2 ? [...queryCases].reverse() : queryCases) {
				const sample = await querySample(words.db, runtime, test.query);
				if (!sample.hits || sample.partial) throw new Error(`query failed: ${test.query}`);
				if (test.name === "cross_icu_fallback") assertCrossIcuSample(sample);
				(round < warmups ? queryWarmups : queryRaw)[test.name]?.push(sample);
			}
		}
		report.queries = Object.fromEntries(
			queryCases.map((test) => [
				test.name,
				{
					query: test.query,
					terms: runtime.tokenizeQuery(test.query),
					summary: summarizeTiming(queryRaw[test.name] ?? []),
					warmup_samples: queryWarmups[test.name],
					measured_samples: queryRaw[test.name],
				},
			]),
		);
		const sentinel = corpusRow(0);
		const newer = Number(
			await words.db
				.prepare("SELECT COUNT(*) AS n FROM memories WHERE space_id = ? AND updated_at > ?")
				.bind(spaceId, sentinel.updated_at)
				.first("n"),
		);
		const oldScan = await words.db
			.prepare(
				"SELECT id FROM (SELECT id, title, body FROM memories WHERE space_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 500) WHERE instr(title, ?) > 0 OR instr(body, ?) > 0",
			)
			.bind(spaceId, "早上", "早上")
			.all<{ id: string }>();
		const recall = [];
		for (const query of ["早上", "他早上喝什么", "黑咖啡"]) {
			const result = await querySample(words.db, runtime, query);
			if (newer <= 500 || result.first_id !== sentinel.id || result.partial)
				throw new Error(`old-record recall failed: ${query}`);
			recall.push({ query, ...result });
		}
		if (oldScan.results.some((row) => row.id === sentinel.id))
			throw new Error("sentinel unexpectedly inside old scan");
		report.old_record_recall = {
			sentinel_id: sentinel.id,
			newer_records: newer,
			reproduced_old_latest_500_scan_hits: oldScan.results,
			cases: recall,
		};
		(report.load as unknown[]).push(machine());
		await save();
		console.log("开始配对写入采样");
		const writes: Record<
			string,
			Array<
				Timed & { preparation_ms: number; total_ms: number; round: number; executed_first: boolean }
			>
		> = { trigram: [], trigram_words: [] };
		const writeWarmups: typeof writes = { trigram: [], trigram_words: [] };
		for (let round = 0; round < warmups + samples; round++) {
			const records = Array.from({ length: batchRows }, (_, index) =>
				corpusRow(rows + round * batchRows + index),
			);
			const hashes = records.map((row) => sha256(row.title + row.body));
			const ordered = round % 2 ? [...lanes].reverse() : lanes;
			for (const [order, lane] of ordered.entries()) {
				await assertMarker(lane.db);
				const start = performance.now();
				const statements = records.flatMap((row, index) =>
					createStatements(lane, row, hashes[index] as string, runtime),
				);
				const preparation_ms = performance.now() - start;
				const timing = await timedBatch(lane.db, statements);
				(round < warmups ? writeWarmups : writes)[lane.name]?.push({
					...timing,
					preparation_ms,
					total_ms: preparation_ms + timing.wall_ms,
					round,
					executed_first: order === 0,
				});
			}
		}
		const writeSummaries = Object.fromEntries(
			lanes.map((lane) => [
				lane.name,
				{
					...summarizeTiming(writes[lane.name] ?? []),
					preparation_ms: summarize(
						(writes[lane.name] ?? []).map((sample) => sample.preparation_ms),
					),
					total_ms: summarize((writes[lane.name] ?? []).map((sample) => sample.total_ms)),
				},
			]),
		);
		report.writes = {
			summaries: writeSummaries,
			measured_samples: writes,
			warmup_samples: writeWarmups,
			paired_total_delta_ms: (writes.trigram_words ?? []).map(
				(value, i) => value.total_ms - (writes.trigram?.[i]?.total_ms ?? 0),
			),
			median_total_overhead_percent:
				((writeSummaries.trigram_words?.total_ms.p50 ?? 0) /
					(writeSummaries.trigram?.total_ms.p50 ?? 1) -
					1) *
				100,
		};
		report.storage_after_writes = Object.fromEntries(
			await Promise.all(
				lanes.map(async (lane) => [
					lane.name,
					await storage(lane, rows + (warmups + samples) * batchRows),
				]),
			),
		);
		for (const lane of lanes) await assertMarker(lane.db);
		await miniflare.dispose();
		miniflare = undefined;
		report.persisted_files = await physicalFiles(runPath);
		report.source_end = { head: git("rev-parse", "HEAD"), dirty_scope: git("status", "--short") };
		(report.load as unknown[]).push(machine());
		report.status = "complete";
		report.finished_at = new Date().toISOString();
		await save();
		console.log(`基准完成，原始结果: ${resultPath}`);
	} catch (error) {
		report.status = "failed";
		report.error = error instanceof Error ? error.stack : String(error);
		await save();
		throw error;
	} finally {
		await miniflare?.dispose();
	}
}

await main();
