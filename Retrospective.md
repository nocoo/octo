# Retrospective

### 2026-10-22 - Preserve filter drafts across collapsed sections

Moving Apply into an always-visible filter bar made hidden numeric fields reachable by submission. A Chromium regression reproduced native validation blocking submission without revealing the invalid field. The form now checks validity, synchronously opens the advanced section, and then asks the browser to report and focus the invalid control. Advanced controls remain mounted so collapsing them never discards their submitted values. Applied chips come from URL state, not unsaved controls, and removing one chip does not reopen an already-collapsed panel while other advanced conditions remain.

Freeform multiselect options also initially duplicated a known display name as a new identifier. A failing unit test established the ambiguity; matching known labels now suppresses that extra candidate while unknown URL selections remain editable. Several browser assertions still assumed a text input for spaces or a direct child header after earlier composition changes; update those selectors to the real controls while retaining value, visibility, focus and history assertions. Typecheck also rejected an assumed Banner variant; inspect installed component declarations instead of guessing variant names.

Screenshot inspection then found long space identifiers painting outside their inline-flex badges after separating the metadata columns. Table and badge scroll widths alone did not detect the painted text overflow. A failing Chromium check now measures text Range rectangles against the badge bounds; the affected record tables use wrapping inline-block badges without truncating their values.

### 2026-10-22 - Verify shared navigation in its real host

Moving Back into the shared page header introduced router hooks into two SSR test suites that previously rendered their pages without a router. The initial unit run failed until those fixtures supplied MemoryRouter, matching the application host. Keep the existing PageHeader filter slot intact when composing navigation; moving filters outside it also broke the search-header contract. Browser checks now cover title/subtitle alignment, direct-entry fallback, guarded history navigation and command-dialog focus restoration.

The first command-layout test matched the close-label text separately even though its rendered hint includes the Escape key in the same element. Match the complete hint rather than weakening visibility assertions. Running full coverage alongside browser startup also repeated the existing resource-contention timeout problem; run the final heavy suites serially without increasing deadlines. A temporary registry install expanded mirror URLs throughout the lockfile; remove only those generated URLs and confirm the dependency change remains limited to the already-resolved cmdk version. The commit hook caught descending CSS specificity after enlarging icons; use low-specificity scoping and place base selectors before modifiers, then rerun visual checks.

### 2026-10-20 — Inspect shared fixtures before adding setup

The vector invalidation regression initially inserted a destination space already
provided by the shared SQLite fixture, producing a uniqueness error rather than
the intended behavioral failure. Reusing the fixture restored a meaningful RED
run. Inspect shared seed data before adding setup, and check each failing test's
cause before treating its failure as TDD evidence.
The pre-commit typecheck also caught a stale cron-test import after renaming the
retry interval. Search all consumers, not just the implementation directory,
before changing an exported identifier; keep hooks enabled to catch omissions.
The first batching pass also held a repaired client vector behind newly stale
embedding work. The existing priority regression caught the 15-second delay.
Flush ready records before slow embedding preparation, not only at the end of
the outer chunk, and retain latency assertions when changing queue grouping.
Removing periodic rewrites also exposed a profile-switch race: a drain could
retry with its captured, now-inactive profile and acknowledge obsolete work.
A failing regression now covers switching profiles during upsert. Claims and
acknowledgements require the captured profile to remain the sole active profile,
leaving switched work pending for a fresh drain.
The full L2 run still modeled invalidation by clearing `indexed_at` and changing
only `due_at`, which exercised the retired periodic rewrite path. It now verifies
that a legacy deadline does not rewrite an acknowledged vector, then mutates
authoritative metadata and proves the trigger-driven cron repair. Update
integration fixtures alongside changed scheduling contracts, not just unit tests.
Independent MAX review found another invalidation boundary: enabling backfill
did not revive live memories whose missing vectors had previously been handled
as acknowledged deletions while backfill was off. Two RED regressions cover an
explicitly disabled setting and an absent default setting. Transactional settings
triggers now requeue only missing or stale active-profile vectors on enablement.
When removing periodic repair, audit configuration transitions as well as source
row mutations, including work that completed without producing a derived row.
The subsequent L2 run exposed an obsolete gateway stub that accepted connection
tests only; legitimate newly requeued backfill requests failed its assertions and
timed out. Gateway fixtures now distinguish connection tests from background
embedding requests and return one vector per input, preserving connection-test
failure modes rather than suppressing the production backfill behavior.
MAX review then reproduced stale completions cancelling a newer rate-limit
deadline because invalidation equated zero attempts with no backoff. The RED
regression holds a newer throttled owner's deadline across an older completion.
Invalidation now checks the explicit error state rather than the failure counter;
uncharged retries are still retries, and source mutations alone reset that state.
The reviewer also paused failure handling between lease release and clearing
`indexed_at`. A newer owner could succeed with the same generation and zero
attempts, after which the old clear erased its acknowledgement permanently.
A RED interleaving regression now proves that clearing requires a still-pending
generation, so completed newer work cannot match the delayed failure update.
MAX review found a second priority boundary inside a large ready chunk: if later
records became stale before the first flush, a PUT arriving during that flush
still waited behind 15 seconds of newly required embeddings. A timing regression
reproduced the delay. Mid-chunk repairs now yield embedding claims back to the
durable queue and run first in the next bounded repair round. Test transitions
before and during a flush, not just mutations after a fully prepared batch.
Final MAX review reproduced preparation absorbing a newer generation without
producing its vector: backfill could be enabled after disabled preparation, or a
body PATCH could invalidate an in-flight embedding CAS. Removing hourly rewrites
made the subsequent deletion acknowledgement permanent. Three RED regressions
now cover both races and repeated invalidation at the repair limit. The atomic
acknowledgement predicate rejects live missing/stale vectors while backfill is
enabled, preserving the signal through bounded retries instead of treating a
refreshed generation number as evidence that preparation completed its work.

## 2026-10-19 — Assert backing data behind an accessible modal

The first dashboard v2 Chromium run failed in the new deletion retry test:
after the intentional 503, a default role locator could not find the backing
table row while Basalt's modal correctly hid the rest of the page from the
accessibility tree. The error and dialog were still present; this was not a
deleted-row regression. The test now checks attachment with `includeHidden`
and separately verifies the retained row through the real admin API. Use
ordinary visible-role queries again after closing the dialog; do not weaken
modal accessibility to satisfy a background-content assertion.

## 2026-10-19 — Verify color token formats before composition

During the dashboard v2 pass I initially wrapped Basalt tag foreground tokens
in `hsl()`, assuming they shared the channel-only format of `--basalt-primary`.
The installed stylesheet showed that tag foregrounds are complete `oklch()`
colors. I corrected navigation styles to use `var()` directly before committing
the theme. Inspect the installed token declaration, not just its name, before
composing CSS color functions; unit-rendered class names alone do not validate
the resulting browser color.

### 2026-10-19 — Space management validation assumptions

The first space PATCH schema derived optional fields from the create schema. Zod 4 retained the create-time description default inside the optional field, turning an empty patch into a description-clearing write. MCP regression tests caught this before commit. The shared PATCH schema now removes create defaults explicitly; tests reject empty updates and verify that name-only updates preserve descriptions. Optionality is not the same as removing a default.

The first move implementation correctly added a source-space tombstone, but two existing tests still assumed that one write always produced one change event. The normal pre-commit hook rejected that snapshot; assertions now require both source and destination events. A separate workerd test queried a two-character token that was only a substring of its fixture word, despite the documented whole-token short-query behavior. The fixture now contains the actual short token and failures identify the search channel. Validate test inputs against the real contract instead of weakening assertions or changing unrelated search semantics.

An offline, lockfile-only Bun synchronization still expanded the temporary registry into package URLs. Inspection caught the mirror-only diff before staging; removing those generated URLs left the lockfile byte-identical because the private root package version is not recorded there. Offline mode prevents network access, not registry-dependent serialization. Inspect the lockfile diff and mirror-URL guard even when no dependencies change.

### 2026-10-19 — 搜索夹具必须尊重回收站保留的 FTS 映射

回收站分支 rebase 后的全量 L2 在搜索排名夹具初始化时触发 fts_rowid 唯一约束，导致整组测试未执行。两份搜索夹具让 FTS 自动分配 rowid，再以 FTS 最大值写映射；但移入回收站只移除 FTS 内容，映射仍占用该 ID。先在两份夹具中加入保留映射且没有 FTS 内容的回收站记录，在全新隔离 D1 稳定复现两组初始化失败，再按生产仓储规则从映射表分配新 ID。原搜索、排名、权限和候选数量断言保持不变，增加哨兵仍在回收站且未被重新索引的断言，清理只涉及本组记录。夹具直接写数据库时必须遵循正式写入路径的标识分配规则，不能通过重复运行掩盖共享数据顺序问题。

### 2026-10-19 — 移动端空状态需要独立于宽表格

回收站完整 L3 一度全部通过，但人工检查 390px 截图发现空状态沿用宽表格的最小列宽，提示和入口被水平裁切。新增真实浏览器完整视口断言，稳定测得标题可见比例仅 0.299426；组件断言同时证明空状态仍在表格内部。修正为无记录时直接渲染 Basalt LayerCard.Empty，保留原分页页脚，不添加自定义样式。可见性断言不代表内容完整可见；空状态和短屏状态必须检查实际视口比例与截图，不能只依赖桌面流程成功。

### 2026-10-19 — FTS 探针不能假定共享测试索引为空

回收站最终 L2 验证中，既有 FTS 子串测试查询整个共享索引，其他用例生成的 MCP 标签随机含有 `cdef`，导致预期一条却命中两条。读取带 `env=test` 标记的本次本地 D1，确认额外命中来自标签而非搜索实现错误；随后加入确定性的无关记录，稳定复现相同失败。探针继续使用真实 `memories_fts` 和原有匹配、排序、删除断言，但限定到本用例的负数 rowid，验证无关记录未被删除，并在 finally 中仅清理自己创建的记录。共享测试数据必须有显式作用域，不能靠随机名称碰撞概率或重复运行获得通过。

### 2026-10-19 — 回收站拆分必须保留失败后的用户意图

独立回收站页面初版把所有操作结束后的全选状态都收敛为失败 ID，导致预检失败、单条删除和清空中途停止时丢失尚未处理的跨页选择及排除项。复审触发交互回归，先得到确定失败，再按整批是否完整解析区分选择收敛；部分操作保留原始全选意图，仅移除已删除的排除项。单条删除失败还错误关闭了已经完成标题核验的确认框，被既有真实浏览器测试捕获。修复保留确认阶段、框内错误、直接重试和取消后的原按钮焦点。拆分 ViewModel 时不仅迁移成功路径，也必须逐项保留失败状态、确认阶段和焦点约定；全量 L3 不能由新功能单测替代。

### 2026-10-19 — Preserve staged writes when batching tag reads

The new 100-memory restore test exposed 10,300 tag-related reads for 100 tags per memory. A first joined-read optimization bypassed the existing staged memory overlay: repeated IDs in one HTTP batch lost pending tags, and the rename regression rejected a previously valid identity-preserving read. The full suite caught both before any commit. The correction keeps association IDs owned by MemoryRepo and hydrates tag rows in one query through TagRepo, including its pending-tag overlay. Optimize the shared read boundary, not only persisted SQL; rerun staged transactions and concurrency regressions whenever replacing an N+1 path.

### 2026-10-18 — Validate published schemas and isolate shared dictionaries

Round-one MAX review found that Zod's runtime nonempty-patch refinement disappeared from the published MCP JSON Schema. An SDK JSON Schema validator reproduced acceptance of a version-only update; explicit branch property minima now make discovery match runtime validation. Fragment assertions alone cannot prove a generated schema's behavior. The same review found that the new order test's generic `alpha` label could shadow another L2 file's fixed tag ID in the shared global dictionary. A subsequent full L2 run reproduced the foreign-key failure. The order test now namespaces every tag, preserving normalization, deduplication and reorder assertions without depending on file order. Use namespaced fixture identities across the shared L2 database and exercise generated public schemas with a real validator.

### 2026-10-18 — Verify pane mutation targets from returned metadata

During round-one worker layout cleanup, `herdr pane resize --current --direction left --amount 0.34` unexpectedly returned a mutation of the focused pane in another tab instead of the calling pane. No repository files or processes there changed. The affected tab was restored to the prescribed one-third controller layout using an explicit pane ID; its exact previous ratio was not captured. The task tab was then resized with an explicit ID and verified against returned pane and tab IDs. Use explicit pane IDs for layout mutations, snapshot the original split ratios first, and inspect the returned target immediately rather than trusting caller-selection flags or option order.

### 2026-10-18 — Keep shared fixture assertions aligned

The round-one tag visibility fixture added an independent hidden-space tag to a memory already used by the merge assertion. The index-snapshot hook correctly rejected the first commit because that assertion still expected only the merged tag. The expected associations now include the unrelated tag, proving merge preserves it. When extending a shared fixture, inspect all later exact-state assertions before committing; never weaken the hook. Initial repository discovery also used an unsupported Herdr command and guessed absent paths; those read-only probes had no side effects. Discover commands and directories before addressing them.

The tag-position migration exposed that the local startup runner reapplies every post-core SQL file. Earlier files were idempotent table creation, but repeating an ALTER TABLE failed. A regression now checks restarting preserves an already stored non-default position; local startup checks the column before replaying this additive migration. Production must apply numbered migrations once through D1 migration management. Inspect every migration executor, not just clean-database fixtures, before adding a schema change.

### 2026-10-18 — Check binding assertions beyond adapter tests

The Vectorize metadata fix passed the focused adapter suite, but the first commit was blocked by a route-level production-binding assertion that still expected the invalid boolean. The hook stayed enabled and no failing commit was created. Update binding expectations at both the adapter and its HTTP callers before considering focused tests sufficient; port-level boolean inputs remain unchanged.

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

The first request-API integration then exposed a separate class-brand boundary:
Node's FormData passed Undici's broad request check but not its serializer's
own FormData assertion, leaving multipart bodies unsent. Four real multipart
cases failed while the raw/chunked cases passed. The adapter now rebuilds only
the FormData container with Undici's exported class, retaining every field,
duplicate name, File object and byte payload; it does not buffer or shorten
the upload. A focused regression verifies the actual client class plus file
identity and duplicate fields. Library support must be checked through its
serializer, not inferred from a structural entry-point type alone.

## 2026-10-18 — Validate MCP schemas with the consuming SDK

The first MCP adapter described tag list items using the broader tag serializer
shape rather than the actual `listWithCounts` projection. Handwritten HTTP
assertions accepted the results, but the official MCP client's output-schema
validation rejected `list_tags` because the published schema required timestamps
that v1 intentionally does not return. The red client-interoperability test now
exercises all nine tools after `tools/list`; the schema and Chinese contract
describe the existing projection instead of changing the v1 response.

That same test next exposed that SDK 1.32.1 validates `structuredContent` even
when `isError` is true. Each published output schema now explicitly admits
either the v1 success projection or the common redacted error envelope. Both
success and failure remain machine-readable and pass the official client.
Adding hybrid/vector search to that test also caught a mistaken profile object:
v1 returns its profile ID string. Exercise optional non-null branches when
deriving schemas; a text-only search with a null profile cannot prove that shape.

The SDK's low-level request parser also surfaced malformed tool-call parameters
as an internal JSON-RPC error. The adapter validates known request schemas before
dispatch and returns a sanitized invalid-parameters error. Protocol tests must
verify wire error codes and official-client consumption, not just HTTP success.
Local command wrappers must avoid zsh's read-only `status` variable; a security
scan completed successfully but its first result-printing wrapper failed for
that unrelated shell reason. The underlying scan log was checked directly.

The first real-HTTP rollback probe could not reach its injected failure: its
seven-way UNION count query exceeded workerd D1's compound SELECT limit. Seven
scalar COUNT subqueries retain all table-level rollback assertions without
changing production code, adding retries, or reducing the fixture. Native
SQLite unit helpers are not evidence of D1 SQL-limit compatibility.

## 2026-10-18 — Audit logical MCP outcomes, not only HTTP

Independent MAX review reproduced two integration errors after the initial MCP
suite passed: HTTP 200 tool failures disappeared from usage errors, all POST
reads counted as writes, and unsupported methods were logged as unmatched
internal failures. Regressions now exercise the complete audit-to-rollup path,
including real workerd HTTP and cron, instead of only individual audit rows.
The rollup uses redacted error codes and an atomic audit marker for committed
MCP writes; every method rejection keeps the fixed `/mcp` route.

An initial audit-column implementation exposed that the local migration runner
reapplies post-core SQL. Rather than expand this milestone into a migration
runner rewrite, the additive, idempotent `mcp_audit_writes` extension table
stores only the audit row ID and joins the audit insert's D1 batch. Existing
REST history and schema remain intact; no compatibility fallback, request body,
tool name, key, or session is stored in the marker.

## Dashboard fixture and mirror verification

The first client-boundary commit attempt reached the index hook with lint warnings in AST fixture strings; the hook correctly rejected it. Escaped template literals fixed the fixtures before committing without bypasses. Check warnings as errors before staging. The Microsoft package mirror also lagged behind the required Basalt release; the approved Tencent mirror supplied the published 3.1.0 artifact. Preserve exact package versions and integrity, remove mirror-specific lockfile URLs, and never substitute local source or a different release to clear installation failures.

## Dashboard transport and rendered component contracts

The initial admin-path guard rejected encoded slashes even though valid tag names can contain slashes. A regression test now exercises an encoded tag through the real shared transport; standard URL normalization verifies that requests remain inside the admin namespace without narrowing domain grammar. Integration checks must cross the ViewModel/transport boundary, not stop at fake clients.

Installed Basalt declarations permit ordinary HTML attributes: using `title` on `LayerCard.Header` set a tooltip rather than visible content, and combining `AppHeader.title` with `PageHeader` rendered two H1 headings. Real screenshots exposed the missing titles, and an actual-package SSR test reproduced the duplicate heading before the shell switched to breadcrumbs. Inspect rendered semantics as well as TypeScript signatures. Visual inspection also caught an unloaded embedding configuration being described as having no key; failed reads must remain unknown rather than being represented by editable defaults.

## Dashboard navigation and installed-library review

The initial editor protected browser unload but not in-app navigation, so a sidebar or reader link could discard unsaved edits. Independent review identified the gap before acceptance. The application now uses a data router and a shared pure navigation policy for dirty, saving and uploading states, with explicit discard confirmation. Browser journeys cover reader links, sidebar, command palette and Back; their execution remains blocked until the real admin API is available. Browser unload protection is not a substitute for router-level protection.

The same review found that chart descriptors require `color`, sortable rendered cells require primitive `sortValue`, and TableOfContents requires direct list-item children. Tests against fake data alone did not exercise those installed-library contracts. Actual-package regressions now complement ViewModel tests, and Basalt Collapsible replaces unsupported native disclosures. Trash also incorrectly inherited the visualization sample cap; server cursor pagination now keeps old trash accessible without changing the graph sampling limit. Keep presentation sampling separate from destructive-management access.

## Dashboard gate rollout order (2026-10-18)

I registered the new client-design gate in the working-tree hook runner before committing its package script and the remaining page migrations. An unrelated atomic memory-page commit correctly stopped because its index snapshot did not contain that new script. I restored the existing runner list until the complete gate rollout can be staged atomically; no hook was disabled and the original checks still ran. When introducing a gate, stage its runner registration, command and implementation together, after the code it governs satisfies it, rather than letting pending hook configuration affect earlier snapshots.

During the operations localization work, a shell wrapper used zsh's read-only `status` variable after a completed red test run; the saved test log preserved the evidence, and subsequent wrappers use `result`. Oversized translation commands also failed before execution, so the worker split them into bounded edits. A rendered empty-state assertion initially assumed an undocumented data attribute and was corrected against the installed Basalt markup. Keep command payloads small and verify rendered library contracts rather than inventing selectors.

### 2026-10-18 — Validate real browser boundaries before widening exceptions

The first post-M7 L3 writes still failed after the narrowly scoped test Origin allowance: Wrangler's upstream-host flags removed the request URL port. Removing those local runner flags preserved the real browser origin; production policy was not widened. A visual fixture also initially used PUT for the documented PATCH memory endpoint, then followed stale Wrangler help to `/__scheduled`, which returned the SPA with status 200 instead of invoking cron. The fixture now checks the installed `/cdn-cgi/local/scheduled?format=json` endpoint, JSON content type and actual usage data. Inspect the runtime contract and response meaning, not just status codes.

The primary-link color probe initially accepted a missing CSS token, and its browser helper used an `append` signature conflicting with the Worker ambient types. Requiring a nonempty token exposed the real contrast regression; `appendChild` avoids the unrelated ambient collision. Screenshot inspection then caught a localized secret-label selector masking the entire identically labeled keys page. Intersecting the label locator with inputs preserves credential masking without concealing the UI. Automated green checks require inspected visual evidence, especially when selectors or fixtures can accidentally hide the surface being evaluated.

The final populated overview screenshot exposed `restored` in otherwise Chinese UI. The version-history operation names and change-feed operation names are different wire contracts; a shared label spread and an inaccurate `update` test fixture concealed the missing past-tense cases. The overview now tests the actual repository-emitted change operations and uses an explicit Map with a Chinese unknown-operation fallback. Verify display mappings against producer enums and populated screenshots, not nearby endpoint vocabulary.

### 2026-10-18 — Validate the merged lockfile with Bun

The MCP rebase had additive lockfile conflicts. Combining the conflict blocks preserved both dependency sets, but three shared packages with identical versions and different integrity encodings appeared twice outside those blocks. JSONC parsing accepted duplicate keys; Bun's frozen installer correctly rejected duplicate package paths. Removing the duplicate dashboard entries retained main's locked artifacts, and the approved temporary mirror then installed the MCP SDK with `--frozen-lockfile`. A generic JSON parser is not a package-manager lockfile validator; always run the frozen installer after resolving dependency conflicts.

### 2026-10-18 — Clear hidden permission fields at submission

MAX review found that switching an existing custom key from selected spaces to all or owned spaces hid the field but still submitted its old IDs. Real browser regressions failed for both transitions against M7's correct rejection, while selected-space preservation passed. The common form payload now includes IDs only for selected-space scope. Hidden fields may retain useful editing state, but submitted permissions must match the currently selected mode; never weaken server validation to accept stale form fields.

### 2026-10-18 — Separate credential clearing from gateway validation

MAX review identified a legal M7 configuration with a saved key and null gateway URL. The consumer assumed a non-null string and routed credential clearing through full gateway validation, so the clear action never reached the server. Two failing regressions now cover nullable wire-to-form projection and a minimal `{ api_key: null }` update guarded by the existing lifecycle. Clearing a credential must not depend on unrelated configuration validity. The browser credential fixture also used a logged `fill` action despite the documented write-only evidence rule; direct input evaluation now avoids putting the replacement value in a Playwright step title.

Contract integration correctly removed fabricated usage from key metadata, but also removed the required per-key sparkline without checking the separate real usage endpoint. MAX review caught that scope omission. The dashboard now loads the full 30-day UTC usage cursor sequence independently of secret-bearing key state, renders the installed Basalt Sparkline and exposes each real daily count. Removing an invented DTO field does not authorize deleting its user-facing requirement when another supported endpoint supplies the data.

### 2026-10-18 — Inspect badge content, not just viewport bounds

The populated desktop screenshot exposed long space and tag values escaping memory badges even though the page itself had no horizontal overflow. The first SSR assertion accidentally matched an unrelated wrapping rule and was tightened to the badges' actual parent before recording red evidence. A real installed-component browser probe then confirmed overflowing text ranges before the shared wrapping fix and contained text in both list and card views at mobile and desktop widths afterward. Its first development bundle also mismatched the React production runtime; building the probe consistently in production mode resolved the tooling error. Visual checks must inspect local content bounds, and regression selectors must identify the exact element under repair.

The subsequent graph capture showed another local readability failure: painting every complete title on the canvas obscured nodes and links. A real canvas probe recorded all fifteen labels before the fix. The canvas now relies on its existing hover/selection detail and accessible node table instead of duplicate overprinted labels; selected names remain complete and wrap outside the canvas. Its new fixture initially omitted the required node href; the commit hook correctly rejected it despite the passing runtime test, and the fixture was completed before resubmission. The HTML-report inspection also initially matched an unrelated embedded base64 asset; selecting the explicit application/zip MIME type correctly identifies Playwright's report archive. Inspect specific graphical content and artifact formats rather than treating page-level bounds or a generic data-URL match as sufficient evidence.

MAX's final mobile inspection found that the badge containment fix did not guarantee readable columns beside long titles. The initial geometry probe used a short title, so it missed the metadata column collapsing to 73px and producing a 294px row with long title/space/tag values. A combined long-field regression now fails before minimum column widths and passes afterward, retaining the existing internal table scroll and complete wrapped values. Test interacting content constraints together; containment alone can still produce an unreadable layout.

The same screenshot review caught plain Markdown lists inheriting Basalt's control-oriented list reset. Semantic list elements alone did not retain visible markers or indentation. A real HTTP browser regression first failed on the missing bullet, then scoped prose rules restored unordered and ordered markers and token-based indentation. Task markers are suppressed per task item rather than per containing list, preserving ordinary items in mixed task lists. Validate Markdown rendering against the installed design-system stylesheet, including nested lists, non-default numbering and mixed task items in both reader and editor preview.

The final freshness check attempted a rebase while this regression fix was still unstaged. Git correctly refused without changing the branch. Fetch and inspect ancestry during an active fix, but commit the verified atomic change before rebasing; do not introduce a stash just to bypass that boundary.

### 2026-10-18 — Validate diagnostic fixtures before counting red tests

The embedding diagnostic regression fixture initially omitted the required memory source key ID, so its first failures occurred during setup rather than exercising diagnostic behavior. After correcting the fixture, the 43 diagnostic assertions were rerun against an isolated pre-diagnostics commit snapshot and failed on the intended missing failure metadata, without setup errors. Gateway red tests had already exercised their intended behavior. Count a red result only after checking failure locations; fixture errors do not establish TDD evidence, and a later baseline replay must be distinguished from the original run.

### 2026-10-18 — Validate browser state and every exposed permission editor

The key-form repair replaced an ambiguous space-ID text field with the installed Basalt picker and retained server validation paths. The first viewmodel commit attempt passed runtime tests but failed the index-snapshot typecheck: a boolean validator did not narrow optional permissions, and an explicit undefined name violated exact optional property types. The hook blocked the commit; the typed boundaries were corrected before retrying. Run strict typechecks with focused tests before treating a change as commit-ready.

Independent MAX review then found two interactions missed by the initial tests. Disabling native form validation exposed a datetime-local state where a partially erased date has an empty value and badInput=true; treating that as an intentional clear could remove an existing expiry or mint a nonexpiring credential. Submission now checks the actual input validity and routes incomplete dates to field validation, while genuine clearing remains allowed. Review also caught an editable readonly-space picker whose selection the template serializer discarded. Readonly requests now preserve and validate the server-permitted scope and IDs. Regressions exercise actual Chromium date-segment editing, explicit clearing and persisted readonly selection changes. Test browser-native state rather than only onChange strings, and verify serialization for every role receiving a newly exposed control.

Screenshot review exposed native gray button backgrounds and outset borders on the MultiSelect options. The standalone Basalt reset was scoped to the application frame, but the options render in a body portal outside that frame. The Basalt-only SPA now scopes the same documented reset on its body, without custom component CSS. A real Chromium regression first reproduced the incorrect computed styles, then checks transparent borderless options, keyboard highlighting, selection and Escape focus restoration. Inspect portaled content independently from the component trigger and keep shell and Markdown regressions in the final gate.

Validation also ran while system daemons sustained a high host load. Overlapping broad gates, and later restoring the default unit-test worker count, increased contention and produced unrelated fixture timeouts. Those runs were retained as failures or explicit interruptions, never as passing evidence. Run heavy checks serially with bounded worker concurrency on a loaded development host. The owner separately authorized 30-second timeouts for the full-repository test-skip fixture and local Miniflare startup, plus an asynchronous L3 marker query that no longer blocks the fixture process event loop. Every assertion, isolation check and coverage threshold remains unchanged, and marker verification must finish before a mutation.

On resuming against newer main, the first UI commit hook caught a lost permission-grid layout marker. The extracted form had also omitted main's responsive grid sizing. Both were restored in the extracted form and the existing source-composition assertion now reads that file; focus restoration remains in the page. Resolve merges against surrounding layout as well as conflict markers, and rerun the full integration gate before committing.

A Herdr resize issued with `--current` unexpectedly targeted the focused pane in another tab rather than the caller pane. The returned pane IDs exposed the mistake immediately; explicit pane IDs restored both controller layouts to the prescribed left third. Use explicit verified pane IDs for layout mutations and verify the returned target before continuing.

### 2026-10-18 — Preserve exact optional types in race fixtures

The vector requeue race passed its runtime regression after the fix, but the commit hook rejected assigning `undefined` to an optional string binding under `exactOptionalPropertyTypes`. The fixture now omits the binding for the default mode rather than assigning `undefined`. Runtime test success does not replace strict fixture typechecking; the hook remained enabled and blocked the invalid snapshot.

### 2026-10-18 — Capture resumed regression evidence explicitly

During the resumed vector requeue verification, the isolated baseline regression failed at the intended synchronization assertion, but the wrapper then tried to assign its exit code to zsh's read-only `status` parameter. The replay was repeated with a writable variable and explicitly recorded exit code 1; neither a wrapper failure nor an interrupted historical run counts as current gate evidence. Use nonreserved shell variable names and preserve each verification command's exit code before reporting its result.

### 2026-10-18 — Drain setup audit work before installing write spies

Response-byte accounting moved unknown-length response auditing behind stream completion. Its focused tests passed, but the index-snapshot commit gate caught ten MCP tests whose database-batch spies also observed the preceding create request's deferred audit batch. The tests now flush that setup request's waitUntil tasks before installing the spy, retaining the assertion that invalid updates perform no business batch. Await response consumption and the explicit background barrier when isolating a later request's side effects; do not change production audit timing or weaken assertions to accommodate an implicit scheduling assumption.

The full direct-workerd suite then caught a transport regression absent from Node stream tests: wrapping an in-memory JSON error in a TransformStream discarded its native known-length framing and broke all seven gated early-upload-response proofs. The shared JSON serializer now declares its exact UTF-8 Content-Length before auditing; genuinely unknown streams still use backpressured counting. The transport proofs remain unchanged. Preserve response framing as well as body bytes when adding stream middleware, and verify native upload ownership before treating unit stream tests as sufficient evidence. The MCP audit assertion now compares measured response bytes instead of the obsolete NULL accounting expectation.

### 2026-10-19 — Initialize hooks in new worktrees before committing

The vector synchronization worktree reused installed dependencies but did not contain the ignored Husky launchers. Although core.hooksPath was configured, the first diagnostics commit therefore ran without its pre-commit gate. After detecting the absent output, the project prepare command generated the launchers and the same commit was amended through the normal index-snapshot hook. No bypass flag was used. Verify the executable hook files inside each new worktree before the first commit; a shared Git configuration and dependency symlinks do not install worktree-local hooks.

### 2026-10-19 — Fence retry budgets separately from stale completion repair

Independent review reproduced two concurrency defects after the vector retry tests and full gates passed. An old completion incremented a newer lease's generation; when that newer operation failed, its generation guard discarded the failure and immediately requeued it instead of consuming the eighth attempt. A lease-dirty marker now requests compensation without changing the active owner's authoritative generation. Review also showed that bounded workers inherited the drain's start timestamp, giving late-starting jobs already-expired leases. Claims and completion scheduling now use the current clock, with another ownership/generation refresh before batched deletes. New regressions failed on the prior implementation, then passed for late failures, dead transitions, slow four-worker queues, concurrent restore and superseded deletion batches. Exercise both orderings of old completion versus new failure, and advance the clock across queue wait time rather than testing only lease expiry at drain entry.

The next exact-HEAD review caught an incomplete clock fix: the cron entrypoint still explicitly passed its captured start time into the corrected derived-task runner. A regression through the real scheduled-task entrypoint reproduced an expired fifth-job lease, then passed after making the explicit timestamp test-only and optional. Trace clock injection through every production caller, not just the directly tested worker; scheduler cleanup cutoffs and long-running task clocks have different lifetimes.
### 2026-10-18 — Keep derived search writes out of no-op preparation

The first word-index implementation refreshed tag tokens during tag resolution. Full integration tests caught that an otherwise unchanged memory update then staged derived writes. Token refresh now belongs inside the actual memory-write batch after no-op detection, while rename/merge update their own derived tokens transactionally. Keep preparation read-only for existing entities; a derived index must not turn a successful no-op into a write or a version change.

The live usage change intentionally adds an independent audit-and-usage batch to every authenticated call. Existing business-transaction spies initially counted or fault-injected those audit batches, including late work from setup requests. The fixture spy now routes audit batches to the real database and isolates only business batches for business atomicity/failure assertions; separate usage tests assert audit atomicity and exact counters. Repeated fixture instrumentation also exposed a recursive mock wrapper, corrected by retaining the original database method in a WeakMap. Do not fix these failures by dropping audits or replacing exact assertions with loose call-count bounds.

The first new HTTP question fixture omitted the required tags array; its setup failed before any question ran. Adding the actual schema-required field corrected the fixture. A later targeted run passed all 110 test cases but failed during cleanup with ECONNRESET on the heavily loaded host. That run is not a successful L2 result. Keep setup, body consumption, background barriers and cleanup in the evidence boundary, and rerun the complete lane rather than report only its passing cases.

Independent MAX review found that overlapping Han bigrams and document NFKC normalization could expand valid sub-1MB inputs beyond D1's 2MB value/row limit. Size regressions first reproduced a 2,065,268-byte Han token payload and a 10,560,000-byte compatibility-letter payload. The correction removes the optional bigram expansion and document compatibility normalization while retaining complete word tokens, original frequencies and deduplicated Han unigrams. Input limits are unchanged and no index truncation is allowed. Native D1 boundary writes and the final benchmark must use this corrected implementation, not the earlier smaller-fixture success.

Removing bigrams exposed context-dependent ICU boundaries: a short query could be absent as a complete word even when contiguous in the source. MAX review reproduced both weekly-meeting agenda and coffee-bean compounds. New regressions fail on the word-only correction. The final query path supplements strict word lookup with indexed unigram candidates and verifies each short compound within one original field or canonical tag before LIMIT. It rejects noncontiguous distractors without a newest-N scan, while keeping the bounded index representation. Size safety and recall must be verified together after any token representation change.

The focused native run passed 113 cases, but its shell wrapper assigned the exit code to zsh's read-only `status` parameter and itself failed. Use a nonreserved name such as `result` and preserve the child exit code; the final canonical L2 must pass independently before signoff. Existing gate-fixture timeouts under heavy host load also blocked two search commits. Stop failed owned runs, serialize heavy work, and reduce worker concurrency rather than relaxing tests or bypassing hooks.

Single-worker reruns on both installed Node 26 and supported Node 24 reproduced the existing 5-second/30-second timeouts while the new size and compound tests passed. A full canonical L2 later passed 302 of 303 cases but failed one large-body-followed-by-tag request with UND_ERR_SOCKET, not an HTTP application error. Heavy host load is observed, but it does not by itself prove the socket's cause. Keep these runs failed, retain their evidence, and do not turn a narrowly approved code review or a completed benchmark into an overall APPROVE while gates remain unresolved.

A prepublication scan found 29 generic-credential false positives in benchmark provenance: JSON used source filenames such as api-key.ts as property names next to SHA-256 strings. The source manifest now uses explicit path/sha256 records, with a reversible representation change and byte-exact original archives. No scan rules or exclusions changed. Scan staged artifacts before their first commit as well as committed ranges; passing a range gate does not validate uncommitted evidence files.

The full browser run exposed an invalid empty-state fixture after the deliberate OR fallback change: a Chinese query containing knowledge/item terms now correctly matched existing knowledge and list records. The recorded DOM showed two real results, not a transport failure. The fixture now uses one absent alphanumeric term while preserving every empty-state, Chinese-label, icon and action assertion. Do not restore strict-only product behavior or weaken the UI assertions just to preserve old fixture assumptions.

The keyboard space-creation fixture also pressed Enter before awaiting actionability. Its opener is explicitly disabled while the initial model load is busy, and keyboard press does not supply click's enabled-state wait. The fixture now asserts enabled state and actual focus before the same Enter interaction; all dialog/error/viewport/Escape/focus-return assertions remain. Readiness assertions strengthen the journey without a sleep, retry, timeout increase or replacement mouse click.

The first Round 3 push was correctly blocked by an L2 fixture collision after independent approval. Search fixtures let FTS choose an automatic rowid, but trashed memories retain their mapping after their FTS row is removed. A later fixture could therefore reuse an occupied mapping ID; test ordering made earlier full runs pass. A deterministic retained-trash fixture reproduced the same UNIQUE failure in an isolated run. Fixture seeding now allocates from the mapping high-water mark, like production writes, and inserts both indexes using that explicit ID within the same batch. Preserve lifecycle-reserved identities when seeding derived indexes; do not dismiss constraint failures as host load or retry the push without investigation. Earlier approvals remain tied to their original SHA until the fixture correction is reviewed and validated.

Restarting the reviewer with a long shell command exceeded the terminal's canonical-mode line limit before launch. Keep shell launch commands short, wait for the agent prompt, then deliver the task through the agent prompt API instead of embedding the whole brief in the shell command.

## 2026-10-19 — Vector convergence evidence and fixture transactions

The vector incident brief suggested missing write-triggered synchronization and generation-suffixed IDs. Source inspection disproved both: `waitUntil` already existed, IDs were stable memory IDs, and final results were Map-keyed. Regressions instead reproduced a global queue that did not target the just-committed write, stale-vector acceptance without generation/content verification, and duplicate channel contributions before fusion. Do not convert a production symptom or suggested diagnosis into a confirmed cause without reproducing the responsible path. The precise production latency and reported repeated final IDs remain unverified without production access.

Independent review reproduced a missed wakeup in the first correction: a body PATCH held the embedding lease, a newer client PUT skipped that live lease, and the old gateway failed. The superseded failure released the lease but left the new generation waiting for cron. A regression now requires the holder to retry that newer generation in the same bounded drain without another embedding call; same-generation failures still back off. Audit stale failure exits as carefully as successful stale acknowledgements whenever write-triggered work relies on an existing lease holder.

The same review exposed an assumption inherited from single-input embedding calls: response array order was treated as input order. A legal out-of-order indexed batch poisoned two content-cache entries with swapped vectors. The gateway now requires a complete unique in-range input-index mapping before returning any vectors; a regression checks both the initial memory rows and later cache-only replay in reverse request order. When batching a previously single-item integration, validate association semantics as well as call counts. A multi-file patch also failed on stale documentation context after applying its test-file edit; blindly replaying it duplicated an import and test, which static checks rejected. Inspect affected diffs after a partial patch failure and retry only the missing edits rather than assuming a multi-file patch is atomic.

Batching embedding preparation caused four acknowledgements to reach the Node SQLite test adapter together. Its asynchronous transaction body allowed overlapping `BEGIN` calls on one connection, unlike serialized D1 batches. The failing integration exposed three acknowledgement failures after one success. The adapter now serializes complete batches, retaining real rollback semantics; the same concurrency test passes without reducing production concurrency or weakening the lease assertions. Test doubles must preserve the transaction scheduling guarantees of the service they model.

Cache contention is coordination, not an upstream outage. Initially, a cache-busy error sent an entire mixed sync batch into two-hour backoff, including a current client vector and a deletion that required no model. The synchronizer now partitions claimed work before forming embedding batches; ready vectors and tombstones bypass that dependency, while all actual embedding-batch members still fail together. Test successful but overlapping gateway work, not only provider failures, when enforcing write-latency targets.

The inherited memory hash concatenated title and body without preserving their boundary. Moving characters between them could retain the same hash despite a different embedding input, bypassing the new cache's exact text key. Memory provenance now hashes the JSON title/body tuple. Metadata-only writes carry forward only vectors matching the previous current hash in the same fenced transaction, avoiding needless calls when stored hashes are canonicalized; genuinely stale vectors remain stale. Check every early no-op predicate, not only the final cache key, when asserting embedding economy.

The next review found that per-group readiness partitioning did not remove head-of-line blocking across groups: a late ready client waited behind four successful embedding batches, and a superseded cron claim waited until the end of a hundred-job round to repair a new PUT. Controlled clocks reproduced 12–18 seconds without any provider failure. The due cohort now schedules ready work first, and each concurrency-sized group completes its bounded repair loop before subsequent groups. A further RED test changed readiness after initial classification; keeping the larger ready round still delayed repair by 15 seconds, so ready groups use the same bounded scheduling unit. Audit queue boundaries and mid-drain state changes, not only each callback's local order.

The hash correction initially missed two representations of the same write: restore's specialized memory SQL retained the old hash while vector SQL canonicalized it, and the batch service's staged vector view did not mirror the new SQL carry-forward. Restored client vectors became stale, and a following identical vector PUT in the same batch created an unnecessary version. Restore now writes the canonical memory hash, and staged vectors use an immutable matching-hash update so rollback checkpoints remain valid. Tests cover direct/staged legacy restores through synchronization with backfill off, same-batch no-op PUTs, stale vectors and rollback. Enumerate specialized persistence paths and transactional in-memory views when changing a stored invariant.

Final contract reconciliation caught a cache serialization mismatch: implementation hashed `[text, model, dims]`, while the agreed tuple was `[model, dims, text]`. Both separate inputs, so behavior-only cache tests had missed the drift. Before any production migration, the implementation was corrected and a RED-to-GREEN test asserted the exact digest against the actual truncated outbound text. Persisted-key contracts need byte-level assertions in addition to hit/miss behavior tests.

### 2026-10-19 — Check the script target before choosing test helpers

The smoke polling regression passed Vitest but used `findLastIndex`, which the scripts' ES2022 TypeScript target does not provide. The active pre-commit hook rejected the commit. The test now uses `map(...).lastIndexOf(...)` without changing the compiler contract. The preliminary shell also continued past a formatting failure because checks were separated with semicolons; dependent validation and commit commands must use success chaining. Runtime test success is not evidence of static compatibility.

The repeated-run parser also passed runtime tests before the hook rejected Zod's default `unknown` coercion input in a string pipeline. Reading the installed declarations confirmed the supported `z.coerce.number<string>()` input parameter. Use the library's real input types rather than weakening TypeScript or casting away a pipeline mismatch.

Independent MAX review found an inherited deadline edge that the integer-RTT tests missed: a fractional observation budget could be truncated by the timer and fire less than a millisecond before the deadline. The catch block then treated normal window completion as a request failure, even after both metrics had converged. New create/update tests reproduce the early timer callback at 1,300.4 ms RTT. Each tick now retains its original budget to distinguish a deadline-limited timeout from an ordinary request timeout, and fractional timers round up while metric acceptance remains strictly before the deadline. Clock-only mocks cannot establish timer-boundary behavior; exercise timeout callbacks as well as successful responses.

The first correction retained the old current-clock fallback. Re-review proved that a normal 2,000 ms timeout with 2,000.5 ms of observation budget could be swallowed if its callback ran 1 ms late. A RED-to-GREEN regression now exercises both punctual and late callbacks after the update metrics have already converged. Timeout classification uses only the captured budget, not callback punctuality. When replacing a timing heuristic with authoritative state, remove the old heuristic rather than leaving it as an alternative success path.

### 2026-10-19 — Test jointly pending convergence metrics

The first smoke-polling fix decoupled rank-one evidence from indexing and skipped satisfied metrics, but its slow-transport tests let either indexing or the new vector succeed on the first read. Independent MAX review reproduced a false deadline failure at 1,300 ms RTT when both remained pending until five seconds: recurring hybrid checks consumed the remaining budget before the second new-vector response. The initial commit had already been pushed to the task branch, but was not approved or deployed. New regressions failed for both 3,000 ms and 5,000 ms vector readiness with 5,000 ms indexing readiness. Polling now checks each hybrid query once at the start, prioritizes pending metrics, and resumes repeated hybrid checks only after convergence. The jointly pending case observes all metrics by 9,050 ms without extending the ten-second deadline. Follow-up tests cover overlapping readiness delays and ensure hybrid checks do not repeat while a metric remains pending; isolated single-metric success is not sufficient evidence for a shared deadline.

### 2026-10-19 — Avoid reserved zsh variable names in inspection commands

An instruction-discovery loop used `path` as its iteration variable in zsh, replacing the shell's executable-search array and preventing subsequent inspection commands from resolving. The process exited without changing repository files or persistent shell configuration. Repeating the inspection with `instruction_file` restored normal command lookup. Use descriptive, non-reserved shell variables; in zsh, `path` is linked to `PATH` rather than being an ordinary local name.

### 2026-10-19 — Preserve operations on historical key references

MAX review found that retaining a deleted key's space-owner ID was insufficient: ordinary space edits still validated that unchanged owner against live keys and failed with HTTP 400. A cross-route revoke/delete/edit regression now verifies both retained attribution and continued editing; only assigning a different owner requires live-key validation. The first test draft assumed the SQLite adapter returned null for a missing row, so its initial failure was not valid regression evidence. Checking an empty result set exposed the actual 400-versus-200 failure before the fix. Audit downstream operations as well as surviving rows, and confirm a red test fails for the intended behavior rather than an adapter assumption.

### 2026-10-19 — Match direct and staged transaction errors

Independent MAX review found that the shared space service mapped known conflicts but rethrew unknown direct D1 commit failures. REST's staged commit boundary already returned `unavailable`, while the MCP boundary converted the same failure to `internal`. Four RED regressions reproduced the divergence across the service and all three space tools. The direct commit boundary now returns a redacted `unavailable` error, preserving recognized conflicts, full rollback and failed-write audit accounting. The first commit hook also caught an admin-route regression assertion that still expected the old `internal` response; it now verifies the same shared `unavailable` contract. Shared mutation logic does not guarantee identical adapter semantics: test transaction failures through every commit boundary and document each transport's validation order separately.

### 2026-10-19 — Distinguish library geometry from application overrides

The rename-form composition test initially rejected every inline style in rendered markup, including Basalt Grid's own column template. The application had not introduced custom spacing. The assertion now rejects padding and margin overrides while allowing package-owned grid geometry, and the repository design gate checks application source separately. Test the forbidden customization rather than treating implementation details of an approved component as application violations.

The first successful browser run also let Playwright scroll an offscreen rename button into view automatically. Screenshot inspection showed that the new trailing action column was hidden at the ordinary desktop width. The action now sits immediately beside the space name, with a RED-to-GREEN column-order regression and explicit browser viewport assertions before interaction and after reload. Successful automated clicks do not establish discoverability; check the initial viewport as well.

Independent MAX review then reproduced the same issue with a legal 256-character Chinese name: the table's nowrap name cell expanded beyond the viewport despite its declared column width. A port-free Chromium probe and unit regression failed before the fix. The Basalt link now has a token-bounded width and ellipsis, retains its complete accessible text and exposes the full name on hover. The real rename-and-reload journey starts from the maximum-length name. Column order alone does not bound intrinsic content width; exercise valid worst-case content before accepting table geometry.

The same review found that the action column inherited DataTable's default sortable header even though its accessor returns an interactive button, not sortable data. Unit markup and Chromium assertions reproduced the unwanted header control. The column now explicitly disables sorting, and the persisted rename journey verifies that the control stays absent. Review library defaults whenever a data column becomes an action column.

### 2026-10-19 — Preserve backfill ownership during metadata-only drains

MAX review reproduced a move holding the vector-sync lease while a body PATCH queued a newer content generation. The move's repair loop correctly avoided embedding calls but then acknowledged the newer missing-vector generation after deleting its stale index entry, delaying ordinary backfill until hourly reconciliation. Three RED regressions cover already-missing vectors and concurrent PATCH after both successful and failed move upserts. Metadata-only drains now release live missing-vector jobs without acknowledgement or backoff; the next ordinary drain can embed immediately, while deleted and purged jobs still complete. A no-model-call policy must preserve unfinished work ownership rather than treating absent derived data as completed work.

### 2026-10-19 — Restore focus when a filtered rename removes its opener

Rename cancellation coverage only exercised connected row buttons. MAX review reproduced a successful rename under a name-only filter: the updated row disappeared, its opener unmounted, and the dialog left focus on the document body. A unit callback regression and real Worker-backed Chromium journey failed before the fix. Closing the rename dialog now restores a connected opener or falls back to the space filter, preserving the user's filter and the persisted rename. Dialog focus tests must cover successful mutations that remove their own trigger as well as cancellation.

### 2026-10-19 — Check batch replay targets before skipping failed items

Independent MAX review found that an all-failed move batch checked target existence during idempotent replay but skipped every item's authorization. A hidden existing target therefore replayed with HTTP 200 while a nonexistent target returned HTTP 404, revealing hidden space existence. Two RED regressions reproduced the difference for explicit-space and owned-space scopes. Replay now checks current target visibility before skipping failed items, returning the same 404 for hidden and nonexistent targets. Initial batches retain identical per-item not-found results for both targets. Test all-failed cached responses as well as successful or mixed batches whenever authorization depends on iterating their items.

### 2026-10-19 — Measure empty states inside their actual scroll containers

The first full-height empty-state pass looked centered on desktop, but table column widths pushed the composition outside the mobile viewport. Narrow empty tables now omit their unused headings; populated tables retain their original layout. Chromium also exposed a fractional-pixel clipping edge after scrolling an action into a short viewport, so empty-state actions use token-based scroll margins. Geometry checks cover the enclosing table cell or card, reserve pagination space, and verify horizontal alignment, complete action visibility, and dialog focus restoration. A centered child or a successful automated click alone does not establish that the complete composition is visible.

### 2026-10-19 — Compare computed geometry, not utility names

Giraffe's header links declare a 32px width but Basalt's minimum control size makes them 34px in Chrome. Copying the utility width alone would preserve Octo's mismatch. During shell alignment, a Basalt Grid wrapper also initially used its default two columns, halving the sidebar search width and wrapping its label. The wrapper now explicitly declares one column, and browser regressions assert the full 244px by 38px search and actual header-control dimensions. Check library defaults and computed geometry before treating similar markup as visual parity.

Independent review then found that relocating rail controls unmounted the focused button, while removing compact header density also removed Basalt's coarse-pointer touch sizing. A Chrome reproduction confirmed body focus, 34px touch targets and a stale desktop-derived expanded state in the mobile drawer. Rail toggles now focus their replacement, header controls retain 44px coarse-pointer targets, and drawer ARIA state uses the rendered rail. Visual parity must preserve keyboard focus and input-device behavior, not only desktop dimensions.

### 2026-10-20 — Avoid external visibility probes against the local D1 index

PR #20 failed two Linux L2 cases with ECONNRESET after the new backfill trigger populated historical vectors. A fresh local full suite passed, but that did not establish data-size or test-order independence. The local brute-force adapter returns id/score without external generation/hash metadata, so the external visibility loop could never confirm its candidates. Every subsequent global drain repeated up to 50 full D1 vector scans, including synchronous test-mode drains after unrelated tag writes. A deterministic 65-identical-vector unit regression found zero visible generations. With 200 acknowledged 1536-dimensional vectors, the original usage test exceeded its unchanged 120-second timeout; the old-code pressure run was then stopped. The initial pressure seed accidentally left indexed_at null because insertion triggers clear it; correcting that fixture was necessary to exercise the visibility path.

The local store has no asynchronous external index. It now confirms current acknowledged D1 rows directly, retaining profile/model/dimension, content, scope and generation fences; external stores still require matching query metadata. The same pressure fixture then completed the original three cases in 3.1 seconds, with the usage case in 600 ms. The permanent usage regression seeds 64 acknowledged identical vectors and verifies their visibility alongside exact accounting. No fetch retries, socket tuning, larger timeouts or rate-limit changes hide failures. A separate transport probe accepted complete requests with 20-second response delays; its approximately 15-second timeout applied to incomplete request headers, not response work. The local timeout reproduces the nonconverging workload, not the exact Linux reset, whose final validation requires the PR CI run.

### 2026-10-20 - Wait for dev readiness before browser acceptance

During the Basalt 3.2.0 upgrade, a browser probe started immediately after restarting the development command. Local schema preparation was still running, so Caddy returned 502 and the heading assertion timed out before the application loaded. This was a verification-order error, not evidence of a UI regression. Confirm a successful local `/api/live` response with a connected database before opening a fresh browser page; terminal command admission or an older readiness line does not prove the restarted process is ready.

The full Chromium run then exposed four assertions tied to the previous Basalt presentation: gradient hover, inline-code and version font sizes, and sidebar-search height. Published CSS and a fresh browser measurement confirmed the new solid fill, 18px code, 12px version text, and 39.140625px intrinsic search height. Only those assertions were updated; keyboard, focus, overflow and layout checks remain. Compare failures with the selected package before restoring obsolete styling or weakening behavioral checks.

A documentation commit hook overlapped the API and browser suites and hit two unchanged 5000ms unit-test deadlines after the upgrade's first hook had passed. Verification was rescheduled without overlapping suites rather than increasing timeouts. Also scope exploratory role locators to their owning sidebar: the header and rail both expose search controls.

### 2026-10-20 - Verify record layouts against the rendered control

The first dashboard polish screenshots showed that declaring flex on an inline Field did not replace its inherited column direction, and the first key-column widths still clipped the final action. The browser regressions also initially used a section title as a table name and group instead of the installed ToggleGroup's radiogroup role. Inspect the rendered accessibility tree before selecting controls, measure radio/button centers rather than a fieldset including its legend, and compare a table with its own scroll viewport, not the padded content island. Explicit row direction, bounded record content and narrower key columns now pass the corrected long-name, keyboard-selection, pagination and native-theme checks. Screenshot inspection remains necessary after types and markup tests pass.

Populating event time in the visual fixture exposed a separate history omission: the diff API returns epoch milliseconds, while the history view printed every scalar with String. Independent screenshot review found the raw timestamp in all four variants. The formatter now accepts the actual numeric timestamp (including zero), and history displays explicit UTC while retaining the unset state. Cover populated optional fields and their real API representations instead of assuming reader JSON and diff JSON use identical date types.

The final graph review also caught newly assigned table type colors contradicting the existing canvas legend. Type badges now retain the same blue/tag, green/memory and gray/cluster associations. Check existing legends before assigning categorical colors to another representation of the same entities.

### 2026-10-20 - Separate layout readiness from pixel precision

The v0.4.2 release CI caught two browser assertions that passed on macOS. Pagination sampled the size control before the memory response rendered and the next-page button afterward, comparing y=165.984375 with y=1496 from different layouts. The test now creates its own record, waits for that record to render and retries the unchanged half-pixel alignment assertion instead of relying on earlier tests to populate the page.

The long-history check required an exact IntersectionObserver ratio of 1; Linux reported 0.998088777 despite the wrapped value. The assertion now measures clipping at each edge in CSS pixels, allowing at most one pixel for fractional scroll rounding rather than accepting a broad percentage tolerance. Text equality, internal horizontal overflow, visible intersection and screenshot checks remain. No application styles, suite retries or test timeouts changed. Cross-platform CI must pass before deployment; local screenshot acceptance alone does not establish it.

### 2026-10-21 - Verify mounted routes before sharing list parameters

The first local demo import assumed the admin trash list accepted the memory list's
`spaces` filter. Its mock transport accepted that request, but the mounted admin
purge route uses a different strict query schema and returned 400. Preflight ran
before all writes, so no local data changed. A RED regression now reproduces the
rejection; the importer instead uses the existing memory list's `include=trashed`
option to identify both active and deleted records through one documented contract.
Trace the actual mounted route, not a similarly named parity handler, and verify
the real local HTTP path before treating mocked importer tests as integration proof.
