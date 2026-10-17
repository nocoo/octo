# Retrospective

## 2026-10-18 — Replace the L2 proxy, not the API assertions

M5 accepted a local Wrangler ProxyWorker exception after early responses to finite oversized uploads produced a non-JSON 500 or broke the next request. Removing those cases made the local suite green but left the 50 MiB boundary and multipart envelope contract unproved over HTTP. M7 encountered the same proxy failure. A standalone comparison already showed direct Miniflare/workerd handling the same early responses correctly.

The L2 runner now bundles the real fixture Worker and serves it through the pinned Miniflare API directly, keeping local D1/R2 storage, marker checks, fixture isolation and the daily Vite/Wrangler workflow. The deleted attachment file is restored byte-for-byte from the pre-exception revision; all seven gated native-owner probes are unchanged. A focused run against the old runner reproduces the failure before the direct-runtime validation. The first Miniflare attempt still placed its assets router/RPC proxy before the application and passed 135/136 cases, with an EPIPE on the oversized extra field. Separating the assets binding produced one green run, but the real pre-push hook caught another EPIPE on keyed declared oversize and correctly blocked publication. Inspecting Miniflare's socket assembly showed that the ordinary listener still forwards through its entry Worker. The final runner uses `unsafeDirectSockets` on the application service and retains the separate assets binding; all 136 cases pass without touching assertions or client behavior. The pre-push hook explicitly checks no-remote mode before running L2 and security checks.

For future transport failures, compare the application runtime with development middleware before relaxing acceptance coverage. Keep rejected assertions as the migration's regression proof, distinguish local evidence from production guarantees, and retire an exception only after the original assertions pass on the replacement path.

Incident narratives and lessons for octo, newest first.

## 2026-10-17 — Detached workers lacked Husky launchers

M7 worker worktrees inherited `core.hooksPath=.husky/_` but not the ignored Husky
launchers. Linking dependencies alone did not install them, so the audit worker's
first commit did not execute pre-commit even though no bypass flag was used.
The worker detected this, ran the exact-index gate, installed launchers with
`bun run prepare`, and was instructed to recreate the commit through the actual
hook. All other workers were told to verify executable launchers before committing.
Worktree bootstrap must verify the resolved hook executable, not just hooksPath
or tracked hook source. The controller also verifies the integrated index before
signoff; a worker's claimed test pass cannot substitute for hook execution.

## 2026-10-17 — M7 contract draft assumed an envelope

The initial M7 admin contract described a `{data}` success envelope before checking
`jsonOk`, which actually returns the raw JSON payload. Inspection caught the mismatch
before route integration; the controller corrected the document and notified every
worker. Contract-first work still requires checking existing serializers and error
codes before documenting them. A draft must not silently change a parallel client's
wire format.

## 2026-10-17 — A literal idempotency fixture triggered secret scanning

Removing only the authorized multipart variants made the remaining raw test's synthetic idempotency label a literal. Gitleaks classified that fixture as a generic API key and correctly blocked the range gate. It was not a credential; a shorter synthetic label preserves the test semantics without a scanner exemption. The unpublished introducing commit was amended so history scanning also passes. Keep the compensation integration before the amended test commit so its index-snapshot hooks retain all passing regressions; do not bypass hooks or assume a later deletion removes a historical scanner finding.

## 2026-10-17 — M5 rebase omitted compensation diagnostics

Rebasing M5 onto `41d469f` required combining main's memory authorization, OCC hashes and safe error mapper with attachment hashing and R2 compensation. Reusing the shared mapper preserved recovery but initially dropped M5's request-ID-only cleanup failure log. The existing attachment transaction suite exposed three failures; restoring the diagnostic in the shared catch retained the original assertions without duplicating the mapper. Compensation still runs before saved-outcome recovery so a concurrent losing upload can remove its uncommitted blob; replay authorization still rechecks main's current memory and batch permissions. The fixture Worker now uses main's production memory routes rather than restoring the removed fake service. Zheng separately accepted the three documented local-proxy oversize scenario removals; that decision does not waive integration regressions or claim the SDK defect is fixed.

## 2026-10-17 — Final instruction checks must include delegated tests

The final instruction pass found newly added one-letter fixture, counter and context identifiers after functional approval and the first branch push. They were renamed without changing assertions or behavior, and the new revision was sent through hooks and independent signoff again. Review all additions for repository instructions as well as behavior before declaring the branch final.

## 2026-10-17 — First-use replay authorization retained an empty own-space list

Final MAX review combined first-use space creation with lost acknowledgements and concurrent idempotent requests. Although the transaction had committed exactly once, replay authorization still used the bearer-time empty owned-space list and returned 404. Single-memory and batch authorization now derive own-scope space IDs from committed D1 ownership before checking the saved response. Four red/green cases cover both endpoints under eight-way contention and lost acknowledgements; two negative cases transfer ownership after commit and prove that recovery does not trust a staged authorization overlay or disclose the saved body. Updating only the writer's authorization clone is not sufficient for another request or recovery path.

## 2026-10-17 — Production batch integration and recovery used incomplete boundaries

The rebased application still mounted M6 writes only through a fake injected memory service. Real batch routes now reuse M2's staged transaction, retain per-request row/tag-ID overlays, and roll back SQL plus predicted state after individual failures. L2 observes production memory/version/tag/FTS/change effects rather than `_m6_memories`. Error mapping reads persisted state and the initial version, not a later predicted batch version.

MAX review then reproduced another recovery bug: the handler had already consumed the request body when replay authorization tried to clone it. A request-scoped cache now retains bounded authorization input before consumption; cache recovery still rechecks current permissions and resource visibility. Tests cover eight simultaneous same-key creates, committed writes with lost acknowledgements, scope changes during recovery, large valid batch bodies, and failing D1 diagnostic queries. A diagnostic failure preserves 503 rather than turning storage unavailability into 500. No HTTP retries or assertion weakening were introduced.

## 2026-10-17 — Resolving retained tags by name recreated renamed tags

The first commit-time tag guard covered changes after resolution, but MAX review found an earlier window: current associations were read as names, a rename committed, and create-or-get resolution created a second tag under the old name. Omitted-tag writes now retain association IDs, reload/follow those identities and never create tags from their names. A SQL-boundary regression performs the rename after the association SELECT and proves the original tag remains attached under its new name. Restore follows merged identities, missing identities fail closed, and pending IDs are visible only while their owning INSERT remains staged.

## 2026-10-17 — Auto-owned spaces were an untracked write side effect

Reading the M6 preparation contract after staging memory and tags exposed one remaining immediate write: first-use space creation. A rejected first memory could leave an empty owned space. The HTTP service now prepares that space in the same statement sink and uses its anticipated slug/ID for the memory plan. Its request-local pending space is reusable only while its insert remains staged, so failed batch-item checkpoints cannot retain a nonexistent resource. A red/green real-auth test verifies rejected-input cleanup and a single successful batch containing the first space and memory.

## 2026-10-17 — Secondary memory fields mixed visibility snapshots

Extending the history-race investigation reproduced hidden tags leaking through GET and list after a memory moved between the initial authorized row read and the tag query. Before serialization, both paths now revalidate IDs against the originally read space, version and deletion state in one bounded JSON-parameter query. Moved entries are rejected or omitted, so separately loaded tags, attachments and vector status cannot accompany an obsolete authorization snapshot. The regression interleaves a real move and retag operation rather than mocking a successful authorization result.

## 2026-10-17 — Saved memory responses bypassed current authorization

The generic idempotency middleware returned saved memory bodies before M2 handlers could apply current M1 scope and operation checks. Red tests reproduced successful replay after permission withdrawal, scope removal and a move to a hidden space. Memory write authorization now runs before replay lookup and again before returning a saved outcome, including looking up a created response's current memory. It checks move/rollback destinations without reapplying the old OCC token and preserves authorized DELETE/restore replay. The first implementation changed the established auto-own-space name-collision error; focused API tests caught it and the read-only precheck now preserves that contract. Authentication is not sufficient authorization for a cached resource response. A later patch context mismatch also showed why chained patch-and-commit commands must stop on the patch exit status.

## 2026-10-17 — Tag resolution crossed memory transaction boundaries

MAX review demonstrated orphan global tags after rejected memory input and resurrection of a merged tag when a title-only PATCH rebuilt stale associations. HTTP tag resolution now stages new rows into the same request batch; pending-name reuse tracks statement ownership so a failed batch item cannot retain nonexistent tags. Association insertion validates the resolved canonical ID and name at commit, rejecting concurrent rename/merge with `tag_conflict` and rolling back the memory mutation. Regressions verify invalid-input and replay-persistence rollback, pending-tag reuse/rollback, existing aliases, and a real merge interleaved before PATCH commit. Memory version CAS alone cannot protect related entities whose mutations deliberately do not increment that version.

## 2026-10-17 — History reads escaped the authorized snapshot

MAX review reproduced a move between loading the authorized memory and selecting its new hidden version. Version list/get/diff queries now bind the authorized space and current version and require a live memory in the same SELECT. Interleaving regression tests prove that moved content cannot escape. The same review found that `include=trashed` applied only a delete-operation flag, not delete ownership. Its SQL now excludes foreign deleted entries while preserving ordinary live read visibility. Equivalent resource representations must share the full authorization predicate, not only permission flags.

## 2026-10-17 — Memory writes preceded their replay transaction

After integrating M6, M2 still committed its own D1 batch before the middleware saved the idempotent outcome. A forced replay-storage failure returned 503 while the new memory remained. HTTP mutations now stage their full memory transaction for the middleware's sole batch; a guarded version snapshot or trash event aborts the batch if the authorized CAS changes no row. Tests cover every mutation's single commit and effect-free replay, persistence failure rollback, and concurrent moves before PATCH/DELETE commit. Unit setup initially omitted the replay-chunk migration and then reused an existing fixture slug; the corrected tests use the shared fully migrated database. Check the actual schema and fixture identities before attributing a harness failure to production behavior.

## 2026-10-17 — M2 rebase restored obsolete fixture processes

Replaying M2's final pre-M6 commit reintroduced per-command Wrangler fixture processes after main had replaced them with an isolated, cached SDK session. A failing source-import harness rejected the old executor before all three M2 suites migrated to the shared awaited `e2eD1` boundary. The harness now runs every M2 HTTP fixture test, checks one cached session and eight awaited marker checks, and the obsolete executor is removed. Conflict resolution must compare lifecycle contracts, not only preserve independently compiling symbols. The historical tags 30/31 failure was separate: its global `tag_merged` query counted M6's legitimate unrelated event; main's `d774ee5` scopes that observation to `mm1` and `mm2` and seeds an unrelated event in its regression harness.

## M5: prove the response-linked runtime owner, not client cleanup

Rebasing onto `ee74057` retained both milestone histories and generated-config assertions. Main had removed the old asynchronous CLI executor, so its obsolete telemetry patch was not restored; the attachment fixture unit mock was migrated to `openFixtureD1` with disposal assertions after eight failures reproduced the mismatch. The parked stash was inspected: its reader-release direction and finite-pull/source-error tests were reused, but its test-side cancellation was not accepted as runtime proof.

The first transport probe incorrectly treated Node's non-keep-alive request-close event as server termination; Node can initiate that close itself. A cross-request observation then failed with runtime-context errors, and a passive peer-FIN probe timed out. Those failed runs are not early-abort evidence. The accepted probe instead sends an exact limit-plus-one budget, holds tail/EOF, and starts one pending observation read in the original Worker invocation after the application returns. Workerd's native owner rejects that read with its exact response-sent error after proxying the full response. The observer reads zero bytes and application counters remain unchanged while the latch is held. Restoring the premature application cancellation makes all four actual-overflow probes fail; removing it restores the native-owner result. Declared-length and unauthenticated probes additionally enforce zero application bytes. Initial envelope placement and multipart send-budget assertions were corrected to the actual contract before interpreting results.

Wrangler's injected unused-body drainer was another non-production behavior and is disabled only in local child-process environments. Adding a response `Connection: close` header did not resolve subsequent request failures and was removed. Independent minimal workers with no Octo code, auth, D1 or R2 isolated a remaining pinned SDK issue: direct Miniflare/workerd completed ten 413-then-normal-POST pairs, whereas Wrangler 4.145.0's ProxyWorker returned `Network connection lost` 500s for the same workload. The full finite-stream L2 regressions remain in place and failing; neither the native-owner proof nor a green L1 permits calling that acceptance green. Do not change clients, retry non-idempotent requests, delay requests or restart the runtime to conceal connection-pool failures.

## 2026-10-17 — Nested storage links bypassed fixture isolation

The proxy guard canonicalized the run and v3 roots but not their storage descendants. A real SDK A/B regression confirmed that symlinking B's d1 root or database directory to A let B mutate A's canary despite both markers being env=test. SQLite-leaf symlinks and hardlinks also reached SDK startup, even where SQLite subsequently rejected them. Before importing or starting the SDK, fixture initialization now walks v3 with lstat, rejects every symlink and rejects regular files with nlink greater than one. This protects database files and sidecars without following aliases or adding a filesystem abstraction; normal directories and singly linked files remain supported. Unit tests assert zero SDK calls for all four nested-link variants; fresh temporary real-SDK tests verify the same boundary and unchanged A canary, plus ordinary independent A/B writes. Root containment and a reusable test marker are not proof of ownership of the actual backing files. The first probe used invalid uppercase Worker names; correcting the configuration was necessary before treating any failure as isolation evidence.

## 2026-10-17 — Per-command fixture processes defeated the L2 budget

Awaiting Wrangler CLI avoided stale sockets but still spawned a CLI/runtime for every seed, marker and observation. Under host contention full L2 runs exceeded 360 seconds, and a longer diagnostic hit the existing 120-second tag test timeout. A fresh-run spike proved that CLI initialization, official `getPlatformProxy` and the real HTTP Worker share the same marker and data only when proxy persistence points at CLI's `persist-to/v3`. The official API defaults remote bindings on, so fixture startup now explicitly uses `remoteBindings: false` and `envFiles: []`.

Each isolated test process reuses one proxy session; its suite hook disposes after fixture cleanup, including assertion failures, and marker initialization failures dispose immediately. Fixture SQL checks ownership before every operation, validates paired canonical run paths and local configuration, and uses Wrangler's exported SQL splitter rather than a custom parser. The obsolete async CLI implementation and search's duplicate executor were removed; synchronous startup migrations and all HTTP assertions/timeouts remain unchanged. A red wiring test proved duplicate runtime construction; runtime tests protect path/config isolation, ownership, SQL mapping, failures and disposal. The first full proxy run completed in 44.35 seconds with one genuine interface error: the tag fixture's reversed flag order. Standardizing that call fixed the mismatch without adding a compatibility parser. Never infer a quality budget from asynchronous control flow alone; measure complete fixture work and own every runtime's shutdown.

## 2026-10-17 — Read-only POST replay bypassed current authorization

M6's generic non-GET replay middleware captured M4 search and batchGet. Real M1-authenticated unit and HTTP regressions confirmed that identical keyed requests replayed content after scope or read-permission revocation; changed query/IDs returned 409 instead of fresh results. These reads also persisted response bodies in idempotency records/chunks, violating search's audit-only write contract. The two exact read-only POST paths now bypass write idempotency before key parsing, body hashing or storage lookup, while still passing through bearer and current route authorization. Tests reject any replay-storage access, ignore irrelevant malformed idempotency keys, exercise changed input and revoked/restored access, and assert zero stored read outcomes. Existing M6 write/tag replay, transaction, cursor and rollback tests remain intact. New routes must be classified by operation semantics, not HTTP verb alone.

## 2026-10-17 — M4 integration onto M6

Rebasing M4 onto `d774ee5` preserved M6's injected batch-write service, idempotency middleware, scheduled cleanup, cursor code and all M3 routes. The earlier node-SQLite migration helper commit was redundant with main's identical implementation and was dropped; main's async D1 helpers were retained unchanged. The FTS vocabulary regression now uses M6's awaited marker-checked fixture/query helpers. Conflict resolution retained both milestone narratives and the combined endpoint inventory. Full L1 exposed two stale test assumptions: M4's local-config test still expected the production entrypoint rather than M6's explicit fixture Worker, and M6's no-write-service test incorrectly included independent read-only batchGet among absent write routes. Exact assertions now protect the fixture entrypoint, mounted batchGet and absent batch writes rather than changing either runtime contract.

## M5: inspect the failed subprocess exit, not only SQL latency

Moving duplicate cleanup launches did not fully fix the hook: the single final reset still timed out. The exact failed Wrangler log showed all eight SQL statements successful at 09:01:14.996Z (145 ms command duration), followed only at 09:01:25.383Z by telemetry fetch failure. The executor awaited process exit, so successful SQL still exceeded the hook deadline while an ancillary network request kept the CLI alive. My earlier two-case startup measurement was insufficient to establish this actual failure's cause.

The local async D1 subprocess now receives inherited environment plus `WRANGLER_SEND_METRICS=false`; parent/global configuration, registry, dependencies and deadlines are unchanged. A red unit guard proved the missing child override, then verified inherited fields, unchanged parent opt-in and exact error propagation. Reusing a clone of the failing run's state with the actual shared factory completed the same eight-statement reset and true process exit in 599 ms; child tracing recorded only loopback I/O, no Sparrow request. The raw historical failure and elapsed-versus-target gap remain evidence rather than being erased by this focused proof.

## M5: eliminate duplicate fixture process lifetimes, not hook deadlines

The first merged full L2 exceeded my 300-second tool budget and required stopping only its orphaned children. A complete run then took 637.42 seconds and reported one real failure: attachment afterEach cleanup exceeded the unchanged 10-second hook deadline. That complete run was not green, and the suite's <3-minute performance target remains an explicit gap.

An event-driven measurement against the same isolated Worker counted twelve awaited Wrangler commands for two attachment cases, totaling about 11.45 seconds (individual commands 0.75–1.22 seconds), while the HTTP handlers took milliseconds. Setup already reset the preceding case; afterEach launched another marker query and reset after every case. Keep setup isolation and move final cleanup to afterAll on the owned executor, with a fresh marker guard and scoped deletion in one CLI command. The guard deliberately violates the marker value's NOT NULL constraint if ownership is absent or foreign, before deletes. Include only this suite's replay rows/chunks in cleanup. Unit regressions prove command counts, foreign/missing marker refusal, unrelated-row preservation, partial-seed/failed-body cleanup, and awaited cleanup failure; do not raise hook deadlines, retry requests, or redesign the merged executor to hide lifecycle latency.

## M5: compensation failure must not skip outcome recovery

My deferred R2 compensation callback could reject while deleting a rolled-back blob. Awaiting it before checking the completed replay outcome then turned a concurrent loser's valid replay into 500, and unkeyed/keyed failures with no winner also became 500 instead of 503. A deterministic two-upload barrier reproduced 201/500; separate rollback cases reproduced both incorrect 500 responses. The HTTP boundary now isolates callback exceptions, emits only a fixed cleanup-failure label and request ID, then still verifies a committed winner or returns unavailable. Failed cleanup remains visible; a failed business write without an outcome never becomes success. Metadata existence/unknown verification rules are unchanged.

## M5: rebase must integrate the HTTP transaction owner

The consolidated M5 snapshot passed L1 after rebasing onto M6, but that alone did not make its immediate attachment batches participate in replay transactions. Ten new production-route regressions failed first: upload/delete committed before replay-storage failure, concurrent uploads left extra blobs, deferred failures bypassed service compensation, and replay bypassed current resource permission checks. M6 also cloned and text-decoded keyed bodies before M5 could authorize or bound them; distinct invalid UTF-8 bytes incorrectly replayed the same upload.

Attachment preparation now authorizes before reading and hashes validated upload metadata plus the file-byte digest. Repositories prepare statements for the existing HTTP-owned batch. The HTTP failure mapper is awaited even when a concurrent winner will replay, so losing R2 objects are deleted only after checking their own attachment row; committed or unverifiable objects are preserved. A stale soft-delete guard aborts the same replay/event batch. The regressions use real M1 auth and transactional SQLite, including rollback, concurrent winners, lost acknowledgements, binary conflicts and keyed read limits. Preserve main's shared async fixtures and its single test-only SQLite fallback rather than retaining a second helper API during conflict resolution.

## 2026-10-17 — Distinguish unused-body rejection from active-reader cancellation

Independent review reproduced a raw 50 MiB + 1 request returning ProxyWorker 500 immediately after a successful exact-limit upload, with no fixture CLI work between requests. My prior 25/25 run did not prove that intermittent path reliable, and the stale-socket experiment does not explain it. I had required explicit cancellation even for a body never read. The matching workerd source retains the incoming body through response sending and delegates unused-body cleanup to the runtime after response proxying. The candidate correction rejects declared oversize without touching the body, while preserving cancellation of an active reader on actual overflow. Reader and route guards failed first because cancellation preceded the error response, then passed after removing that one early cancel. Real HTTP causal verification remains pending the controller's next exclusive window; unit guards alone do not prove the historical 500 fixed.

## 2026-10-17 — Do not block a live HTTP client's event loop

The authorized M5 L2 reproduction failed six first-POST requests after synchronous fixture CLI work with ECONNRESET, UND_ERR_SOCKET or EPIPE. A controlled probe against the same isolated Wrangler Worker warmed a POST connection, executed eight marker queries synchronously (9122 ms), and observed Undici reuse the same socket before UND_ERR_SOCKET. The async control ran the same queries (10336 ms), observed a fresh connection, and received the expected 401 without retrying. Attachment fixtures now use async execFile and await marker checks, inserts, mutations and cleanup; sync startup/schema APIs remain unchanged. The complete L2 then passed 25/25, including both chunked JSON 413 paths, 50 MiB raw/multipart, permission loops and signed download/deletion. The earlier ProxyWorker 500 did not recur even in the pre-fix reproduction, so its historical cause is not proven by the socket experiment; cancellation was not weakened or changed.

## 2026-10-17 — Preserve transport failure evidence

The first attachment L2 review exposed a ProxyWorker 500 on streamed rejection and five ECONNRESETs that unit cancellation mocks could not diagnose. My paired raw/multipart loop also stopped at the first failure without identifying which transport path failed. The cases are now separate, and request errors retain their causes plus method/origin/path without logging auth or signature query parameters. No retries or relaxed assertions were added. Synchronous fixture execution and idle connection reuse remain hypotheses until a controlled HTTP reproduction establishes the cause; passing mocked cancellation is not proof of a delivered 413.

## 2026-10-17 — Pin the isolated public origin

I changed download tests to fetch the absolute signed URL without asserting its origin. Wrangler's host rewrite dropped the reserved port, so the test accepted an unrelated 200 before failing its ETag assertion. The L2 runner now sets the existing `ATTACHMENT_URL_HOST` override to its own isolated origin; unit tests verify default and custom ports and the actual generated env file. Every signed-URL test checks the origin before fetching. Production origin derivation is unchanged. HTTP acceptance remains pending the controller's port window.

## 2026-10-17 — Exercise fixture constraints before handoff

I expanded the attachment permission matrix with a key helper that reused a literal name despite `api_keys.name` being unique. L1 passed because the HTTP fixtures were not exercised there, and the three permission scenarios aborted before their assertions in review. The helper now uses its generated key ID in the fixture name. A SQLite-backed L1 test invokes the actual helper four times against the real migration and verifies permissions and cleanup. Unexecuted L2 assertions are a pending verification requirement, not completed behavioral proof.

## 2026-10-17 — Stream assertions must avoid request cloning

An upload authorization regression test initially used Hono's `app.request(request, {})`. Reconstructing the Request can pull its stream before the handler runs, so a pull-count assertion incorrectly blamed the authorization path. Calling `app.fetch(request, bindings)` directly isolates handler consumption. For stream-order tests, use a zero-high-water-mark source and pass the original Request without wrapping or cloning it.

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

## 2026-10-17 — FTS effective characters and decomposed accents

Counting Unicode code points still misclassified `e\u0301t`: local D1's trigram tokenizer removes the acute mark, leaving only two effective characters. The same-body HTTP query missed, and a mixed query incorrectly retained a plain `et` distractor because no short-term post-filter ran. An isolated local D1 vocabulary probe established the exact removable combining-mark subset; marks such as U+0345, U+0363 and U+1AB0 remain effective characters. Classification now subtracts only that verified subset without normalizing returned terms, composing Jamo or decomposing Hangul. A permanent D1 vocabulary regression checks all U+0300–U+036F marks plus extended marks, accents, Hangul and supplementary CJK against the application's classification; HTTP tests protect both bounded LIKE and original-term instr semantics.

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
## M2 draft client-version authorization race

PATCH and rollback authorized a row at version N but passed an arbitrary client version to the repository. A guessed future version could match a concurrent move into a hidden space. Both paths now reject mismatched client versions before tag resolution and submit only the authorized row's version to CAS. Tests verify no TagRepo or write call for future versions and interleave a legitimate write with a move, comparing memory, versions, tags, FTS matches, changes, and vectors afterward. An OCC token must identify the authorized snapshot, not merely a state the client hopes will exist.

## M2 L2 transport failure at fixture boundaries

The controller's baseline L2 run failed twice with `fetch failed` / `read ECONNRESET` immediately after synchronous Wrangler D1 seeding between HTTP requests. Worker logs showed neither failed request nor a crash. M4/M5 subsequently supplied a controlled transport probe: a warm HTTP POST followed by eight synchronous Wrangler calls (9.122s) reused the old socket and failed with `UND_ERR_SOCKET`; the awaited `execFile` control (10.336s) opened a new connection and succeeded. This proves the blocked-event-loop stale-socket mechanism in that probe, not every isolated `beforeAll` or cross-file scenario. File-level pre-seeding was only a mitigation, not proof of transport safety. All three M2 API files retain that ordering and now await every seed and marker check through M4's identical shared async D1 helper. No retries, sleeps, or socket tuning mask failures; only the controller runs the reserved-port L2 verification. The original route inventory checked registration and anonymous access but did not establish authenticated failure or hidden-scope behavior. A real-HTTP matrix now covers all 13 M2 routes, with additional move/rollback authorization, duplicate-delete side effects, 200-item cursor pagination, alias filtering, payload boundaries, and vector cases. These added L2 assertions remain unverified until the controller executes them.

## M2 draft vector normalization failure

Squaring finite components directly overflowed large vectors to a zero result and underflowed tiny nonzero vectors into rejection. Normalization now scales by the largest absolute component before using `Math.hypot`; regression cases include the largest and smallest finite JavaScript magnitudes. Finiteness checks alone do not prove arithmetic preserves a vector's norm.

## M2 draft payload boundary failures

The request reader buffered the entire stream before enforcing its cap, and the transport cap confused JSON escape bytes with decoded UTF-8 body bytes. A valid escaped body could be rejected while an oversized decoded body returned 400 instead of 413. Streaming now stops and cancels on budget overflow; the bounded JSON envelope allows worst-case escaping while memory routes separately enforce the 1 MB decoded body limit. Tests cover chunk consumption, exact ASCII and multibyte boundaries, and escaped control characters.

## M2 draft D1 parameter overruns

Valid requests with 100 tags, 200-item pages, or combined scope and filters exceeded D1's 100-bound-parameter ceiling. The SQLite test adapter had not enforced that production limit. It now does; collection predicates and tag insertion use SQLite `json_each` with one JSON parameter per collection, preserving atomic writes and global cursor ordering without reducing public limits.

## M2 draft transition atomicity failures

Trash updated by ID alone after authorization and emitted duplicate events when the state transition changed no row. It now binds the authorized version and space, and SQLite `changes()` gates the immediately following event and FTS deletion in the same batch. Ordinary batch failures were also mislabeled as conflicts by comparing timestamps; only a changed version establishes that conflict. Retained vectors now become pending on restore, move, and rollback so the M4 integration can rebuild derived metadata without losing the stored vector.

## M2 draft authorization and rollback failures

The draft checked the current memory but not the historical destination on rollback, and single trashed reads omitted delete authorization. Auto-own-space creation also ran before checking write capability. Rollback caught TagRepo failures as if they were malformed snapshots and silently cleared tags; alias filters confused canonical deduplication with missing names. Regression tests now verify authorization before side effects, unchanged persisted state on rejected rollback, and alias-aware filtering. Keep parsing catches separate from storage calls and authorize every destination, not only the initially loaded resource.

## M7 integrated review corrections

Independent review reproduced a stale partial settings save pairing a newer
credential with an older gateway URL. The save now compares the complete
observed settings snapshot inside its atomic batch. Gateway dimension errors
also require an actual array before deriving its length; untrusted objects must
never flow into the sanitized test response. Both issues require adversarial
concurrency and upstream-shape tests, not just happy-path validation.

The original retry queue reset failures to zero, allowing the same first 50
jobs to starve every later job. Failed jobs now move behind untouched work.
Backfill also assumed D1 `meta.changes` counted only the directly inserted row;
real D1 includes trigger writes. Tests now exercise this count difference and
confirm successful guarded inserts report true.

A fixture barrier test was initially placed under `scripts/`, whose TypeScript
environment deliberately excludes Worker globals. The real pre-commit gate
blocked that import boundary. The test now lives with the server tests; no
compiler contract was relaxed. HTTP tests explicitly drain registered local
background work instead of adding sleeps or polling until an assertion passes.

The first integrated HTTP run passed 194 of 205 tests. New background writes
overlapped the separate local fixture D1 runtime, producing marker-check
failures and local D1 internal errors. Fixture access now explicitly drains the
running Worker's registered background work before opening or querying the
shared isolated store; the existing local-only path and marker checks remain.
Its unit substitutes also need to model this new boundary rather than bypass
the isolation checks.

Both real HTTP embedding probes failed before reaching their local stub.
An isolated workerd reproduction established that `redirect: "error"` throws
`TypeError: Invalid redirect value` immediately, although the host-side fetch
mock accepted it. The gateway now uses supported manual redirect handling and
rejects non-2xx responses without following Location or reading their body.
Browser/Node fetch typing is not proof of Worker runtime compatibility.

The same failed-prefix starvation pattern also affected the bounded R2 purge
queue. A 101-job regression now requires healthy later cleanup to progress;
failed jobs retain their creation time but advance their last-attempt ordering.

## M7 full-review contract corrections

The controller initially missed one finding in truncated terminal output: a
claim whose external call hangs and whose process terminates never reaches the
failure handler. Advancing queue order only in catch still let expired leases
repeatedly block untouched work. Vector claims now persist their scheduling
position before the external call. R2 cleanup likewise records an attempt before
deletion. Deterministic suspended-call tests cover both interruption paths, and
the acknowledgment-failure injection now targets the SQL phase rather than a
fragile preparation-call index. Read the complete review disposition before
asserting that every finding has been handled.

The independent full review found that key rotation compared only the secret
hash while writing a revision calculated from an older row. With a fixed clock,
intervening permission edits could be undone after that revision moved backward.
Rotation and revocation now compare the observed `updated_at` as well; regression
tests preserve newer restrictive permissions and reject stale edits.

Idempotent error replay had the correct HTTP envelope but no current thrown
error, causing audit to label a 409 conflict as `internal`. Replay now carries
only an allowlisted error code in request context, and audit gives that final
response code precedence over any earlier handled exception. Audit still never
reads request or response streams. Real HTTP assertions use the fixture barrier,
not retry-until-success polling.

Management accepted 65-character space slugs and auto-owned key names that the
memory API could never write to. Space creation/rename and auto-own-space key
names now share the 64-character lowercase slug contract; ordinary display-only
key names retain their longer limit.

## M7 local Wrangler proxy blocker — resolved 2026-10-18

A final cleanup inspection accidentally named its zsh loop variable `path`,
which shadows zsh's special executable-search array and made command lookup
fail within that one shell invocation. No configuration or worktree was changed.
The inspection was rerun with `worktreeDir`; avoid shell-special parameter names
in administrative loops.

After the integration fixes, the complete real-HTTP suite passes 205 of 206
tests. The remaining case sends an unauthenticated vector PUT, a readonly-key
vector PUT, then a writeonly-key vector PUT with the same complete 3,132-byte
payload. The first two return 401 and 403; the third has no completed application
response in the probe log and Wrangler's ProxyWorker returns a non-JSON 500,
`Network connection lost`. This localizes the observed failure to the proxy
transport boundary, not a proven internal SDK root cause.
The fixture background barrier removed the separate shared-D1 failures; it did
not fix or hide this transport failure.

An independent worker reproduced the exact sequence with the actual app,
local D1, fixture wrapper and ASSETS router. Direct Miniflare/workerd returns
401/403/403 in all five unchanged, unconsumed-401 trials; its additional consumed
and cancelled response-body probes include three anonymous connection errors,
although all writeonly requests return 403. Native transport is therefore not
claimed to be fully validated or an assured replacement. Pinned Wrangler 4.145.0
fails the third request in all five trials
for each of three client modes: leave the 401 body alone, consume it completely,
or cancel that response body. None of those client changes fixes the proxy.

A disposable installation of Wrangler 4.151.1, Miniflare
5.20261012.1-beta and workerd 1.20261012.1 reproduces the same failure in all
15 exact-sequence trials. Installation used an approved temporary mirror;
repository dependencies and lockfile remain unchanged. No remote Cloudflare
resources were used. These diagnostic comparisons are not acceptance retries.

The failing assertion remained intact. No sleeps, automatic retries, shortened
request body, production drain/cancel workaround, disabled hook or test exclusion
was introduced. This blocked branch publication and full milestone approval until
the upstream proxy is fixed or a native-workerd L2 transport change is explicitly
accepted. Successful application-level and L1 checks do not establish L2 success.

Zheng approved the direct Miniflare migration, merged into `origin/main` at
`1a691a0`. M7 rebased onto that revision without conflicts. The application now
receives L2 traffic through its direct workerd socket, preserving the isolated
D1/R2 fixtures and exact background-work barriers. After installing the locked
direct Miniflare dependency, the complete real-HTTP suite passes all 212 tests
across 22 files, including the unchanged unauthenticated/readonly/writeonly
vector PUT sequence and restored oversized-upload assertions. The full L1 index
snapshot passes 1,142 tests with statements 98.83%, branches 95.86%, functions
99.20%, and lines 99.21%. This resolves the transport blocker; the earlier probe
failures remain historical evidence, not current acceptance results. No assertion,
production body handling, hook, or resource-isolation rule was relaxed.

## M7 purge fault-injection correction

An initial preparation-failure test bound the original database method after installing its spy. The bound spy consumed the next injected failure during the initial lookup, so the test passed without exercising SQL preparation. Capturing the original method before installing the spy exposed an uncaught preparation failure. Purge now maps preparation and commit failures through the same safe 503 boundary, while its transactional guard rejects changed trash snapshots. Fault-injection tests must verify the failing phase, not merely the final status.

The first full-suite run also exposed that the local migration loader reapplies every additive migration. The cleanup table migration now uses `IF NOT EXISTS`, matching the existing migration contract; isolated service tests alone did not establish that contract.

## 2026-10-18 — Include backfill in the durable claim

Fresh post-rebase MAX review found that the integrated derived-task coordinator
awaited its whole backfill batch before entering the leased synchronizer. The
earlier interruption-fairness fix therefore protected Vectorize calls but not
embedding calls. A paused-gateway probe sent 100 calls for the same 50 memories
across two drains while every lease and queue position remained unchanged;
the following purge tombstone could starve after repeated interruptions.

Backfill now runs inside each durable claim, after advancing its queue position,
with the same bounded concurrency as before. Synchronization rechecks ownership
and generation after backfill before writing the derived index or acknowledging
it. A real-coordinator regression first failed with zero claimed jobs instead of
50; it now covers paused backfill, a concurrent drain reaching the tombstone,
expired-lease recovery, and stale-owner completion without overwriting the newer
acknowledgement. Mocking the synchronizer in coordinator tests hid this boundary;
interruption tests must exercise the complete path before every external call.

## 2026-10-18 — Preserve an early HTTP response in the L2 client

After the backfill claim fix, the full direct-Miniflare suite passed 211 of 212
cases: the restored raw 50 MiB plus one byte assertion failed with `write EPIPE`.
The unchanged vector authorization sequence passed. A separate minimal Worker
containing no Octo code returned an immediate JSON 413. Node 26.11.1 Fetch
(bundled Undici 8.11.2) rejected two of five fixed diagnostic trials with EPIPE;
Undici 7.29.1 Fetch rejected four of five. Native HTTP observed the 413 headers
in all five trials, followed by upload-side EPIPE or ECONNRESET. Undici's request
API preserved the complete 413 response in all five trials. These comparisons
were diagnostics, not acceptance retries.

The existing attachment L2 request wrapper now uses the already locked Undici
request API, declared as a direct dev dependency. It forwards the same byte or
multipart body and bridges chunked request/response streams, rather than adding
drains, delays, retries, shortened payloads or exception suppression. Tests retain
all original upload and native-owner assertions; the vector auth test and all
production body handling are unchanged. The first wrapper unit run exhausted
memory because a deep mock-call matcher enumerated the 50 MiB typed array.
The regression now checks body identity instead, preserving the full size
without increasing the heap limit or weakening the transport assertions.
