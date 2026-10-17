# M6 integration boundary

## Atomic writes

Production mounts M2 memory routes and M6 batch writes against the real M2
service. The L2 fixture entrypoint wraps the same application with a local test
marker check; it does not substitute a separate memory implementation. Tests
observe the actual memory/version/tag/FTS/change/vector tables.

The HTTP write middleware owns `AppVars.writeStatements`. MemoryService receives
this exact array through `MemoryServiceContext.statements`. Mutations must only
prepare statements and return their anticipated result; they must not call
`run`, `batch`, external APIs, or mutate persistent/in-process business state.
Reads and space resolution may execute read-only queries. Resolve slugs to real
space IDs; returned records must carry `space_id` and `source_key_id` for M1
visibility and own-entry checks.

The integrated write boundary enforces these invariants:

1. Stage every row/version/tag/FTS/change/vector write in the HTTP-owned array.
2. Keep a request-local read-your-writes view (including duplicate IDs within a
   batch). A failed item must leave that view unchanged. The route removes SQL
   staged by a failed item; the service must not retain its failed overlay.
3. Guard snapshots, authorization-sensitive metadata, and expected versions
   against concurrent changes in the committing transaction. A stale plan must
   abort the transaction, never commit a response that claims nonexistent writes.
   Known per-item OCC failures are returned without staging that item. A stale
   committing transaction aborts rather than saving a successful partial result;
   ordinary storage failures return retryable 503 with no saved outcome.
4. Do not send derived Vectorize/embedding effects before commit. Persist work
   for post-commit processing in the same SQL transaction.
5. Prove the above with M2's real D1 invariants and concurrent mutations. The
   simplified test service is not evidence that M2 integration is complete.
6. Authorize replay access against the current M1 principal before reading a
   saved memory outcome. Permission/scope changes must not expose an outcome
   which the current principal can no longer access. M3's global-tag preflight
   and per-resource/batch memory checks precede replay access. Single-memory
   responses also recheck current resource visibility when recovering an outcome.

HTTP-created tags and first-use owned spaces share the same statement sink.
Pending resources are reusable only while their exact insert statement remains
staged. Tag associations validate canonical ID, name and unmerged state at commit,
so a concurrent rename/merge cannot be undone by a stale memory plan. History
reads bind the authorized memory space/version in SQL, and GET/list revalidate
that snapshot before returning separately loaded secondary fields.

## M3 tag writes

M3 tags/spaces remain mounted in production. The two global-tag POST paths run
M1's `tag_global` authorization after bearer authentication and before the
idempotency middleware, including every replay. Removing update permission or
all-space scope takes effect immediately; restoring permission can replay the
original outcome without another mutation. No M1 implementation is changed.

`TagRepo.rename` and `merge` now
return a `TagWrite` plan, never execute it. Routes stage its statements and
register its transaction-error mapping with the HTTP middleware. Tag changes,
links, mapped-rowid FTS rebuilds and replay chunks commit in one D1 batch.
Standalone repository tests explicitly execute the same plan; there is no
immediate-write fallback in production.

Tag snapshots are checked inside the committing transaction. Merge additionally
guards the anticipated affected-memory count, so a concurrent membership change
cannot commit an inaccurate stored response. A stale rename returns 409
`tag_conflict`; a stale merge returns 422 `unprocessable`, with no partial
business writes or saved outcome. The client may submit a fresh request after
reconciling the concurrent change. No automatic retry is used. Ordinary M3
validation/conflict/auth envelopes and real M1 authorization are unchanged.

HTTP services pass their statement sink to `TagRepo.resolveMany` through its
constructor. Resolution then performs read-only lookups and stages new rows;
it never executes a tag insert while preparing the memory response. Standalone
repository fixtures can still explicitly resolve committed tags.

## Idempotency outcomes and recovery

One D1 `batch()` inserts the unique `(key_id, idem_key)` completed record first,
then business statements, then response chunks. `response_json` stores the
positive decimal chunk count; each separate chunk row contains at most 60,000
Unicode scalars (240,000 UTF-8 bytes). No response-size rejection occurs after
business preparation. Migration `0002_idempotency_chunks.sql` is additive and
idempotent for the existing local migration runner.

There is no durable pending claim in the new flow. A crash before commit leaves
no effects or claim. Any statement/storage failure rolls back the entire batch;
a retry prepares a new plan. A crash or lost acknowledgement after commit is
recovered by reading the completed outcome. Concurrent losers roll back their
entire plan and read the winner: same hash replays, different hash is 409. Actual
storage failures are 503, not hash conflicts. Neither completion errors nor
response-read errors delete a key.

Uncertain pending rows from the reviewed, unintegrated prototype cannot safely be
automatically released: it could already have executed effects. They return 503
and are excluded from automatic retention cleanup. If such rows ever existed
outside disposable tests, reconcile them against business data before any manual
repair. This is not a lease/takeover implementation or a legacy compatibility
path. New requests cannot create these rows.

Completed outcomes and their cascading chunks expire together after seven days.
Unkeyed writes also commit their staged business SQL at the same HTTP boundary.
Whole-request errors discard all staged SQL; per-item errors preserve other items.

## Review handoff

### Remaining phase-1 derived-index integration

M7 is now the implementation owner for this boundary. The durable queue,
post-commit port operations, backfill integration and cron recovery are specified
in docs/02-data-model.md under "M7 derived-index ownership and recovery".

Tracking owner: the phase-1 integration controller receiving the M2 signoff.
That controller must assign an implementation owner before production vector
capabilities are accepted; neither M4 nor M7 is implicitly assumed to own it.
M2 persists vectors and pending `indexed_at` state, but the current scheduled
handler only cleans idempotency records. A separate integrated synchronizer must
cover post-commit Vectorize upsert/delete, metadata changes, successful
`indexed_at` acknowledgement, restore reindexing and retry compensation. Local
D1 brute-force test success is not proof of production Vectorize synchronization.

### Local HTTP verification

Every L2 fixture/observation SQL call awaits shared `e2eD1`, backed by one cached
`openFixtureD1` SDK session per test module/run. The session checks the local test
marker, disables remote bindings, validates isolated persistence and rejects
linked storage. This keeps the client event loop serviceable between requests
without spawning a Wrangler process per observation. Earlier controlled probes
showed that synchronous fixture calls could reuse an expired keepalive socket.
Marker, seed, scope, count, trash/version, chunk, trigger and secret-rotation
queries are all awaited, including `/me` and FTS tests. No HTTP retries, sleeps or
keepalive overrides are used. Startup migration behavior remains synchronous and
unchanged; those commands finish before the server starts.

Run the complete L2 suite serially on port 17059 after the implementation handoff.
The implementer intentionally does not run L2 while the controller/reviewer owns
that lane. L2 tests use the explicit fixture entry and real M1 credentials, and
observe production memory tables to distinguish replayed responses from duplicated
effects. The tags merge-event observation is scoped to its fixture memory IDs,
so unrelated legitimate merge events cannot contaminate its exact assertion.
