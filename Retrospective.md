# Retrospective

Incident narratives and lessons for octo, newest first.

## M6: shared-run observations must be fixture-scoped

M3's tag test queried every tag_merged event and expected only its two memories.
The new idempotency merge legitimately added another event, so reversing suite
imports failed although the first full L2 run happened to pass. Scope the query
to the test's fixture memory IDs and retain exact event-count/entity assertions.
The committed source harness now seeds an unrelated prior merge event, proving
isolation independently of suite order. Serial files are not an ordering or
isolation guarantee; a green full run alone cannot establish either.

## M6: replay middleware does not make immediate writes atomic

Rebasing onto M3 preserved its routes but exposed a transaction integration bug:
tag rename/merge committed before the HTTP-owned replay transaction. Forced
chunk-storage failure returned 503 after tags, links and FTS had changed. M3
mutations now prepare SQL, with snapshot/count guards and transaction-error
mapping; only the HTTP boundary commits it together with the replay outcome.
Test both keyed and unkeyed production routes with real M1 auth, rollback,
concurrent requests and lost acknowledgements, not just middleware fixtures.

The first regression seed reused a slug already present in the shared fixture;
use milestone-specific fixture identities. Another initial assertion assumed
own_entries_only forbids tag_global, but M1 explicitly checks only all-space
scope and update permission for that operation. Read the actual authorization
contract before asserting a new policy, and keep M1 unchanged during integration.

## M6: authorization must run before replay lookup

A saved M3 tag outcome bypassed the route-level permission check: after a key
lost update permission or all-space scope, the same idempotency request still
returned 200 and its saved global-tag response. RED tests reproduced both tag
paths with real M1 credentials. Global-tag authorization now precedes replay
lookup for both POST routes, without changing M1's policy. Restore permission
and the original outcome still replays without another effect. Any future
resource route must establish its replay-access authorization before mounting
behind the generic middleware; bearer authentication alone is insufficient.

## M6: newly merged HTTP fixtures need the same async boundary

M3 added two more L2 files after M6's async fixture repair. Both still called
synchronous Wrangler and tags used a fixed sleep before observations. A regression
now imports their actual sources against in-process production routes, real M1
credentials and SQLite while rejecting the sync executor and deferring async
execution. Shared awaited marker/seed/query work replaces both sync paths and the
sleep, preserving exact side-effect assertions without any server or HTTP retry.

The expanded FTS journey also exposed Node SQLite throwing on an internal FTS
last-insert rowid larger than Number.MAX_SAFE_INTEGER. The test-only adapter now
uses setReadBigInts(true) when executing statements, exactly like M3's existing
adapter, and converts only the bounded changes count. Do not change SQL rowids,
FTS fallback rules or production behavior to accommodate test transport metadata.

When extending that harness, prepare(sql).all() silently executed only the first
statement of a multi-statement CLI seed. Use SQLite exec for mutation commands
and prepare/all only for JSON observation queries. FTS is contentless: projecting
its tags column returns NULL by design. Verify MATCH results through the stable
memory-to-rowid map, not by trying to recover stored FTS text.

## M6: synchronous fixture CLI work can stale HTTP sockets

M5's controlled local-Worker probe proved that eight synchronous Wrangler D1
calls blocked the client event loop for 9122ms; the next POST reused the expired
socket and failed with UND_ERR_SOCKET. Awaiting the same commands asynchronously
left closure processing serviceable and the next POST used a fresh socket.
M6 now uses a promisified execFile executor for every L2 fixture mutation and
observation, including marker checks, `/me` secret rotation and FTS. The existing
synchronous migration runner is unchanged because it runs before the server.
No request retries or keepalive overrides mask failures. Regression tests use an
isolated child process and deferred fixture replies without binding a server.

The deferred-write test initially assumed one event-loop turn also completed
WebCrypto hashing. That let a pending seed spill into the following test. Signal
actual CLI invocation before asserting that the seed awaits its result; never
use an unrelated scheduling turn as proof of asynchronous task completion.

## M6: shared fixture spaces invalidate singleton assumptions

Adding base and scoped spaces to the explicit M6 fixture invalidated the older
admin `/me` test's assumption that Alpha was the entire database. That is a test
isolation error, not an API visibility defect. The regression now runs the actual
L2 test source in-process against real M1 authentication and SQLite, including
unrelated spaces. Admin results must exactly match an independent database
snapshot; scoped and own keys must return exactly their allowed space while
excluding unrelated rows. When extending shared fixtures, exercise existing
suite assumptions without replacing identity or visibility assertions with
status-only checks.

## M6: prove the transaction, not only the replay

The reviewed prototype executed business writes before saving replay data,
released claims after storage errors, and serialized all supposed chunks back
into one row. Its response-only tests could pass despite duplicated effects.
The replacement stages business SQL and commits the unique completed outcome,
business statements, and separate chunk rows in one D1 batch. Tests force chunk
storage failure, lose the commit acknowledgement, race concurrent requests, and
count persisted effects. Future write integrations must prove that same commit
boundary; a method named `complete` or equal HTTP responses is not atomicity.

During the regression-test rewrite, a lookup-error spy also intercepted the
verification reads. Verify persisted state through the unmocked reader so fault
injection remains limited to the operation under test.

## 2026-10-17 — Cartesian Vectorize query amplification

The byte-budget fix bounded individual payloads but not the partition tree: 8 spaces × 100 sources × 50 types with 900-character membership entries expanded to 20,000 queries. Sequential execution did not bound total work. Planning now permits at most 64 leaves, incrementing the projected leaf count before each split and rejecting the 65th before any outbound query. This fixed per-request budget keeps vector calls below 1% of the paid Worker's default 10,000-subrequest ceiling, reserves substantial headroom for authentication, D1 revalidation and auditing, and bounds planning to at most 127 visited nodes and 64 materialized filters. It is an internal work budget, not configurable rate limiting. Tests protect exact-budget success, one-over failure, early termination of the original Cartesian reproduction, and production-route 503 without Vectorize calls; ordinary large-filter and global-topK regressions remain enabled.

## 2026-10-17 — Vectorize filter payload budget

The adapter enforced topK but ignored Vectorize's strict compact-JSON filter limit of less than 2048 UTF-8 bytes. Valid multi-space searches therefore failed in production; character counts and independently sized lists would also miss non-ASCII, escaping and the remaining conjunction fields. The adapter now plans complete filters before any request, bisects oversized `$in` lists while retaining every other predicate, and runs shards sequentially with capped topK. It merges raw cosine scores, deduplicates by best score and reapplies the global cap. An unsplittable filter fails closed as unavailable without an outbound query. Limit-enforcing binding tests cover adapter results and the authenticated production route, combined space/source/type lists, ranges, exact byte boundaries and impossible singletons. Provider limits must be verified on the complete emitted payload, not inferred from individual schema limits.

## 2026-10-17 — UTF-16 search term classification

The tokenizer used JavaScript string length as a trigram character count. `𠮷野` has two Unicode code points but three UTF-16 code units, so it incorrectly entered MATCH and vanished despite being visible through batch reads. Classification now counts code points; short, mixed and long supplementary-CJK tests plus a real HTTP bounded-LIKE regression prevent recurrence. Unicode character contracts must not use UTF-16 length implicitly.

## 2026-10-17 — Divergent search tag normalization

M4 retained an ASCII-only normalizer after rebasing onto M3's Latin-aware tag repository. A tag renamed to `CAFÉ` was stored as `café` but disappeared from uppercase tag searches in every channel. Search now imports the repository normalizer directly; resolver tests preserve unknown-tag and redirect semantics, and real HTTP tests rename a tag before exercising both tag filters across FTS, vector and hybrid. Integration review must compare shared domain transformations, not merely preserve both modules during conflict resolution.

## 2026-10-17 — Unsupported local Vectorize initialization

The M4 binding change incorrectly treated `remote=false` as sufficient for local operation after inspecting the remote-proxy configuration. Independent L2 at `d4413e9` disproved that assumption: Wrangler 4.145.0 initializes the unsupported Vectorize binding before application code selects D1, so the Worker failed before any HTTP tests ran. Blocking remote access and supporting local initialization are separate guarantees.

Current Cloudflare local-development documentation confirms there is no Vectorize simulation. Daily dev now generates a TOML configuration beside the production config with Vectorize omitted; both startup entrypoints explicitly select it. Keeping the same parent directory preserves main/assets/secrets resolution and the existing daily `.wrangler/state` persistence. Isolated L2 configuration generation uses the same omission. Production VEC and fail-closed selection remain unchanged. Regressions inspect files generated by both daily entrypoints and the L2 runner; actual Worker startup remains subject to a coordinated L2 lease, not inferred from parser tests.

## 2026-10-17 — Blocking fixture commands and stale HTTP sockets

M5 reproduced `UND_ERR_SOCKET` after warming a Worker HTTP connection and then blocking the test event loop with synchronous Wrangler commands. M4 search fixtures used the same synchronous executor. The async D1 executor and marker checks are reused verbatim from M5, and search seed/reset/cleanup now await every command so keepalive close events can be processed. Startup migration APIs stay synchronous because they run before the HTTP client is warm; no retries or weaker isolation checks were added.

During the async-fixture commit, a transient Git index lock rejected staging. A shell sequence separated by semicolons nevertheless invoked the hook on the unchanged index; no commit was created. The lock disappeared without intervention. Chain staging and commit with `&&`, verify the staged paths, and do not treat an old-index hook run as evidence for new changes or delete another process's lock.

The final HTTP contract review also caught a test that encoded 400 for a batch of 101 IDs. The specific documented limit requires 413 `payload_too_large`; route-local red tests now protect this boundary, duplicate counting, and authentication precedence without changing generic schema error handling.

## 2026-10-17 — Search response snapshot gaps

The first M4 remediation authorized the final content SELECT but fetched tags afterward and retained ranks/fusion calculated before final visibility pruning. A concurrent space move could therefore mix public content with newly hidden tags, or return inconsistent scores. Independent review identified both omissions; real SQLite interleaving tests reproduced them before correction. Content and tags now share one authorized SQL snapshot, and ranking/fusion run only after final candidate pruning.

The production fail-closed vector factory also exposed missing explicit development mode in both local startup paths. Startup tests now assert the actual shared Wrangler arguments rather than relying on manually constructed test environments.

Future search changes must trace every returned field through its read snapshot, derive all scores/counts from the same final candidate set, and verify environment selection through the real startup entrypoints.
