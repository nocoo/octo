# M6 integration boundary

## Atomic writes

Production deliberately mounts no memory routes until M2 is integrated. Setting
`RESOURCE_ENV=test` does not enable any fixture. Only `tests/fixtures/worker.ts`
explicitly injects the D1-backed test service; the L2 runner selects that entry.
It still uses the real M1 bearer middleware and checks the local test marker
before initializing fixture tables. `_m6_memories` is a test observation table,
not an implementation of M2's version/tag/FTS/change invariants.

The HTTP write middleware owns `AppVars.writeStatements`. MemoryService receives
this exact array through `MemoryServiceContext.statements`. Mutations must only
prepare statements and return their anticipated result; they must not call
`run`, `batch`, external APIs, or mutate persistent/in-process business state.
Reads and space resolution may execute read-only queries. Resolve slugs to real
space IDs; returned records must carry `space_id` and `source_key_id` for M1
visibility and own-entry checks.

M2 integration must satisfy all of these before route mounting:

1. Stage every row/version/tag/FTS/change/vector write in the HTTP-owned array.
2. Keep a request-local read-your-writes view (including duplicate IDs within a
   batch). A failed item must leave that view unchanged. The route removes SQL
   staged by a failed item; the service must not retain its failed overlay.
3. Guard snapshots, authorization-sensitive metadata, and expected versions
   against concurrent changes in the committing transaction. A stale plan must
   abort the transaction, never commit a response that claims nonexistent writes.
   The present HTTP layer returns retryable 503 on a failed commit with no saved
   outcome; M2 must provide consistent per-item OCC outcomes when integrated.
4. Do not send derived Vectorize/embedding effects before commit. Persist work
   for post-commit processing in the same SQL transaction.
5. Prove the above with M2's real D1 invariants and concurrent mutations. The
   simplified test service is not evidence that M2 integration is complete.
6. Authorize replay access against the current M1 principal before reading a
   saved memory outcome. Permission/scope changes must not expose an outcome
   which the current principal can no longer access. M3's global-tag preflight
   is integrated now; per-resource/batch memory replay authorization remains
   part of the production-unmounted M2 integration boundary.

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

`TagRepo.resolveMany` remains the existing M3 immediate create-or-get helper.
M2 must not call it to mutate persistent tags while preparing an HTTP write;
its integration still needs staged tag creation together with all other memory
SQL, rather than reintroducing an out-of-transaction side effect.

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

Every L2 fixture/observation SQL call uses the shared `createAsyncD1Exec` and
awaits `assertAsyncTestMarker` before exposing the executor. This keeps the client
event loop serviceable between HTTP requests: M5's controlled probe proved that
synchronous Wrangler CLI calls could cause reuse of an expired keepalive socket.
Marker, seed, scope, count, trash/version, chunk, trigger and secret-rotation
queries are all awaited, including `/me` and FTS tests. No HTTP retries, sleeps or
keepalive overrides are used. Startup migration behavior remains synchronous and
unchanged; those commands finish before the server starts.

Run the complete L2 suite serially on port 17059 after the implementation handoff.
The implementer intentionally does not run L2 while the controller/reviewer owns
that lane. L2 tests use the explicit fixture entry and real M1 credentials, and
observe `_m6_memories` to distinguish replayed responses from duplicated effects.
