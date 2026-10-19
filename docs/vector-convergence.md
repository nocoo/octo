# Vector convergence and embedding economy

## Contract

- D1 is authoritative. One active-profile vector uses the memory ID as the
  deterministic Vectorize ID. There are no chunk or per-generation IDs to retain.
  Replacements overwrite that ID; deletes, trash and stale-content vectors queue
  deletion of the same ID immediately through the post-commit path.
- Successful REST, admin and MCP memory writes pass their committed IDs into
  `ctx.waitUntil`. They do not compete with the first 50 global cron jobs. Cron
  remains crash recovery, visibility verification and hourly anti-entropy.
  Bulk trash actions retain the separate five-job post-commit work budget from
  migration 0009's release; the budget and committed-ID filter compose without
  freezing the live synchronization clock.
- Ready vectors and deletions are selected ahead of embedding work within the
  chosen due cohort. Each claimed concurrency-sized group finishes its bounded
  generation-repair loop before the next group starts; a cron-owned client PUT
  must not wait behind unrelated successful embedding batches. Readiness is
  rechecked after claims because content can change during a drain.
- The healthy-service target is **at most 10 seconds** from create-with-vector
  to `indexed=true` and vector-search discovery, and from body PATCH plus vector
  PUT to the new self-vector ranking first and the obsolete vector no longer
  matching. External outages/timeouts cannot be guaranteed away: failures retain
  the existing two-hour initial backoff and eight-failure dead-letter policy.
- `indexed=true` specifically means **the current-generation upsert was accepted
  by Vectorize**. It does not claim Vectorize query visibility. No successful
  acknowledgement is synthesized while an upsert is still pending or failed.
- Upsert metadata includes D1's generation and content hash. A self-vector query
  must observe both before `visible_generation` is acknowledged with a generation
  CAS. Until then, the authorized current D1 vectors supplement external search,
  using 100-row ID-cursor pages and only top-K candidates retained in memory.
  There is no time-based overlay expiry. Large pending backlogs therefore increase
  read work; storage, backoff and observability must not silently truncate recall.
- Every external candidate is checked against current D1 generation/content,
  active profile/model/dimensions and all authorization/content filters. Its
  score is recomputed from D1, and nonpositive cosine scores are omitted. An old
  vector with genuinely positive similarity to new content may still match that
  current content; it must never match using the obsolete vector's score. Smoke
  uses orthogonal old/new vectors to make old-ID absence unambiguous.
- Both channels are deduplicated by memory ID **before** ranks, counts, RRF or
  weighted fusion and limits. A hybrid query may still return an old-vector
  target through FTS; this is not a vector match. Search remains read-only except
  for the existing audit path.

## Embedding economy

Migration `0010_vector_convergence.sql` adds the visibility marker, a durable
SHA-256 cache over JSON `[model, dimensions, actual embedding text]`, and per-memory/
profile attempt counters. The text is `title + "\n\n" + body`, truncated to
16,000 characters, matching the outbound input. Model and dimension changes
produce separate cache entries. No plaintext gateway keys or input copies are
stored in the cache or logs.

Memory provenance hashes the JSON `[title, body]` tuple so field boundaries
cannot collide. Metadata-only writes preserve matching current stored vectors
when canonicalizing an older stored hash; mismatched stale vectors stay stale.

No-op updates, tag-only changes, same-generation retries, requeues, and a return
to previously embedded text reuse stored vectors/cache. Current client vectors
skip the model and even gateway decryption/configuration. A batch claims memory
jobs first, synchronizes current client vectors/deletions independently, then
claims cache keys only for live memories needing embeddings, sends distinct
missing inputs, and caches successful
embeddings before the guarded memory-vector transaction, and releases claims.
Gateway responses must supply a unique integer `data[].index` for every input
from zero through input-count minus one. Response order is irrelevant; missing,
duplicate or out-of-range indices reject the batch before caching any vector.
Another live holder cannot double-embed/upsert. Cache contention and gateway
429/5xx/config/storage failures reject the preparation batch so its memory jobs
retain backoff/dead-letter behavior. Stale-memory CAS misses preserve the cache
without replacing a newer client vector.

`vector_status[].embedding_calls` counts outbound participation, including failed
attempts; a shared gateway request can increment several participating memories.
It is not the number of HTTP requests across the account. A body-changing PATCH
can legitimately start backfill before a later PUT; smoke records post-PATCH
totals without claiming that asynchronous work was caused by PUT.

## Smoke usage and safety

Run only after separate authorization for the target environment. This change
does **not** deploy or execute smoke against production.

Provide `OCTO_SMOKE_BASE_URL`, `OCTO_SMOKE_API_KEY` and `OCTO_SMOKE_SPACE` through
the environment (load the key privately, never as a command-line argument).
The space must already exist and be dedicated to smoke. Then run:

```sh
bun run scripts/prod-smoke-vectors.ts
```

Set `OCTO_SMOKE_RUNS=N` to repeat the complete create/update/cleanup sequence
sequentially (`N` defaults to 1 and must be a positive safe integer in decimal
notation). The CLI emits one JSON object with `runs` containing every per-run
report and `latencies_ms` containing `samples`, `p50` and `max` for each metric.
The p50 is the median, averaging the two middle samples for an even count.
Only observed, non-null latencies contribute, including observations from runs
that failed another check; missing metrics are never counted as zero. A metric
without observations has null p50/max. Runs use distinct tags and clean up their
own memories before the next run, even after a reported failure. Any failed run
or invalid configuration makes the overall result fail with a nonzero exit.

The script discovers the active cosine profile, creates its own run-tagged
memories, and reports JSON: create-to-indexed and create-to-vector-hit latency,
PUT-to-new-rank-1 and old-vector-gone latency, repeated duplicate-ID checks,
embedding counters and cleanup outcomes. It checks vector and hybrid results,
uses exact old-ID absence in the vector channel, enforces a 10-second observation
deadline and exits nonzero on failure. Each window starts after the target POST
or vector PUT response, excluding write RTT and the preceding body-only PATCH.
Each polling tick sends just one status GET or search, rotating through status,
vector and hybrid checks with a 250 ms pause between requests. Metrics are
recorded when their own evidence arrives, not after the full rotation. Update
rank-1 requires indexed/non-stale status and both new-vector search channels;
observed regressions still fail the run. Control counters are checked outside
the polling windows. Only tracked IDs created by this run are
soft-deleted in cleanup; it never purges, empties trash, creates spaces or changes
embedding settings. Transport failures with unknown create outcomes may leave a
run-tagged memory for manual investigation; never broaden cleanup to existing
space contents. JSON/logs contain neither keys nor arbitrary upstream errors.

## Root-cause evidence and limits

At `c662f62`, HTTP/MCP already used `waitUntil`; the missing piece was write-ID
targeting. Every write selected the same first 50 globally due jobs, so a new
write could be omitted behind older jobs or leases and wait for later drains.
Regression tests reproduce that queue starvation and prove targeted REST/MCP/
batch writes bypass unrelated backlog without bypassing leases or retry delays.
`c662f62` itself only changed cron clock handling; the exact reported production
100-second duration is not independently measured in this no-production task.

Old-vector matches are directly explained by querying without metadata and
revalidating memory visibility only, without generation/content validation or
D1 rescoring. Already-stale D1 vectors could also be re-upserted after a body
change. The new tests reproduce and remove these stale-score paths.

The proposed per-generation-ID explanation is disproved by the source: upserts
already used `source.id`. Final fused output already used a Map keyed by memory
ID, so three copies of the same final ID were not reproducible from that code.
Repeated channel candidates did inflate counts/ranks/RRF contribution; those are
now deduplicated before ranking. Identical content under distinct IDs and client
rendering/aggregation are separate possibilities, not established diagnoses.
Independent review/local tests are code acceptance, not production latency proof.
