# Retrospective

Incident narratives and lessons for octo, newest first.

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
