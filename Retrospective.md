# Retrospective

Incident narratives and lessons for octo, newest first.

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
