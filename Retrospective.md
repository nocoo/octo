# Retrospective

Incident narratives and lessons for octo, newest first.

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

## 2026-10-17 — Nested storage links bypassed fixture isolation

The proxy guard canonicalized the run and v3 roots but not their storage descendants. A real SDK A/B regression confirmed that symlinking B's d1 root or database directory to A let B mutate A's canary despite both markers being env=test. SQLite-leaf symlinks and hardlinks also reached SDK startup, even where SQLite subsequently rejected them. Before importing or starting the SDK, fixture initialization now walks v3 with lstat, rejects every symlink and rejects regular files with nlink greater than one. This protects database files and sidecars without following aliases or adding a filesystem abstraction; normal directories and singly linked files remain supported. Unit tests assert zero SDK calls for all four nested-link variants; fresh temporary real-SDK tests verify the same boundary and unchanged A canary, plus ordinary independent A/B writes. Root containment and a reusable test marker are not proof of ownership of the actual backing files. The first probe used invalid uppercase Worker names; correcting the configuration was necessary before treating any failure as isolation evidence.

## 2026-10-17 — Per-command fixture processes defeated the L2 budget

Awaiting Wrangler CLI avoided stale sockets but still spawned a CLI/runtime for every seed, marker and observation. Under host contention full L2 runs exceeded 360 seconds, and a longer diagnostic hit the existing 120-second tag test timeout. A fresh-run spike proved that CLI initialization, official `getPlatformProxy` and the real HTTP Worker share the same marker and data only when proxy persistence points at CLI's `persist-to/v3`. The official API defaults remote bindings on, so fixture startup now explicitly uses `remoteBindings: false` and `envFiles: []`.

Each isolated test process reuses one proxy session; its suite hook disposes after fixture cleanup, including assertion failures, and marker initialization failures dispose immediately. Fixture SQL checks ownership before every operation, validates paired canonical run paths and local configuration, and uses Wrangler's exported SQL splitter rather than a custom parser. The obsolete async CLI implementation and search's duplicate executor were removed; synchronous startup migrations and all HTTP assertions/timeouts remain unchanged. A red wiring test proved duplicate runtime construction; runtime tests protect path/config isolation, ownership, SQL mapping, failures and disposal. The first full proxy run completed in 44.35 seconds with one genuine interface error: the tag fixture's reversed flag order. Standardizing that call fixed the mismatch without adding a compatibility parser. Never infer a quality budget from asynchronous control flow alone; measure complete fixture work and own every runtime's shutdown.

## 2026-10-17 — Read-only POST replay bypassed current authorization

M6's generic non-GET replay middleware captured M4 search and batchGet. Real M1-authenticated unit and HTTP regressions confirmed that identical keyed requests replayed content after scope or read-permission revocation; changed query/IDs returned 409 instead of fresh results. These reads also persisted response bodies in idempotency records/chunks, violating search's audit-only write contract. The two exact read-only POST paths now bypass write idempotency before key parsing, body hashing or storage lookup, while still passing through bearer and current route authorization. Tests reject any replay-storage access, ignore irrelevant malformed idempotency keys, exercise changed input and revoked/restored access, and assert zero stored read outcomes. Existing M6 write/tag replay, transaction, cursor and rollback tests remain intact. New routes must be classified by operation semantics, not HTTP verb alone.

## 2026-10-17 — M4 integration onto M6

Rebasing M4 onto `d774ee5` preserved M6's injected batch-write service, idempotency middleware, scheduled cleanup, cursor code and all M3 routes. The earlier node-SQLite migration helper commit was redundant with main's identical implementation and was dropped; main's async D1 helpers were retained unchanged. The FTS vocabulary regression now uses M6's awaited marker-checked fixture/query helpers. Conflict resolution retained both milestone narratives and the combined endpoint inventory. Full L1 exposed two stale test assumptions: M4's local-config test still expected the production entrypoint rather than M6's explicit fixture Worker, and M6's no-write-service test incorrectly included independent read-only batchGet among absent write routes. Exact assertions now protect the fixture entrypoint, mounted batchGet and absent batch writes rather than changing either runtime contract.

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
