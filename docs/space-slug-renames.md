# Space slug renames

## Contract

Space IDs are immutable. REST, MCP and the dashboard can change a slug without
changing key permissions, memories, history, attachments or ownership.
The shared slug schema accepts 1–64 characters matching
`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. PATCH changes only the supplied fields.

`GET /api/v1/spaces/:slug` and PATCH return a quoted numeric ETag derived from
the space's `updated_at` millisecond timestamp. The admin routes use the same
contract. `If-Match` is optional, matching prior space-update behavior; when
provided it must match that token. Stale tokens and concurrent transaction
conflicts return 412 `version_conflict`; malformed tokens return 400
`validation_failed`. Invalid slugs return 400 with `details.issues[].path` equal
to `slug`. An existing canonical slug or live alias of another space returns
409 `version_conflict` with the same field path.

## Alias lifecycle and transactions

`0012_space_slug_aliases.sql` adds
`space_slug_aliases(slug PRIMARY KEY, space_id, created_at, expires_at)`.
The foreign key references `spaces.id` with `ON DELETE CASCADE`.
An AFTER UPDATE trigger records each former slug for exactly 30 days from the
rename's `updated_at`. BEFORE INSERT/UPDATE triggers prevent collisions with
another space's live aliases, including races after application validation.
The slug update, alias changes, existing vector invalidation and change event
commit or roll back together in one D1 batch.

Aliases point directly to IDs, never to other aliases. Repeated renames do not
extend earlier aliases. Renaming back removes the newly canonical alias and
records the just-replaced slug with a fresh 30-day lifetime. Expiry is exclusive:
`expires_at <= now` no longer resolves or reserves a name. Expired names can be
reused immediately without waiting for the existing cron to remove expired rows.
Deleting an empty space deletes its aliases; memories including trash still
prevent deleting a space.

GET/PATCH/DELETE selectors, memory writes/moves/list filters, search filters,
change-feed filters, trash filters and MCP arguments resolve live aliases to
the ID before authorization. Resource responses return the canonical slug.
An alias never widens scoped or own-space permissions. Auto-own-space lookup
uses `owner_key_id`, so renaming does not recreate the old slug; another key
cannot claim a live alias by auto-creating an own space.

## Reference audit and migration

| Surface | Existing reference and behavior |
| --- | --- |
| Key creation/editing and dashboard picker | `space_ids` is validated against `spaces.id`; `api_keys.space_ids_json` contains IDs, never slugs |
| Bearer and search authorization | Scope intersects immutable IDs; ownership loads IDs by `owner_key_id` |
| Memories and versions | `space_id`; no row or historical version rewrite |
| Attachments and R2 | `memory_id` and existing object keys; unaffected |
| FTS/word index and trash | Memory IDs and joins through `memories.space_id`; no rebuild needed |
| Audit and changes | Key/entity/space IDs; audit routes are templates, not stored selectors |
| Settings | Setting names and embedding profile IDs; no space-slug binding |
| Idempotency | Key ID plus idempotency key; request hashes and immutable replay envelopes are not permission bindings and are not rewritten |
| D1 vectors and sync jobs | Memory/profile IDs; existing rename trigger invalidates and enqueues metadata synchronization |
| Vectorize | Existing `space` metadata remains the canonical slug; see below |

No slug-keyed durable relational binding needs conversion. The migration is
additive and does not rewrite existing IDs or snapshot data. The fixture migration
test applies every earlier migration, seeds keys, memories, versions, attachments,
indexes and operational rows, then applies 0012 and verifies preserved data and
permissions. It also verifies rename behavior and vector invalidation afterward.
Apply 0012 before running the new Worker code; this implementation does not apply
remote migrations or deploy resources.

## Vector metadata decision

Retain `space = canonical slug` in Vectorize. Switching it to a new metadata field
would require an infrastructure/index change, which this feature explicitly
avoids. The existing `vector_sync_space_slug` trigger invalidates D1 vector
visibility and queues synchronization. Search converts requested aliases to the
current slug, applies ID-scoped D1 filters, rechecks remote hits against D1 and
merges pending current D1 vectors while remote visibility converges. Renames do
not require recomputing embeddings or creating a remote metadata index.

## REST example

Use an admin-role API key stored in `OCTO_API_KEY`. Fetch the current token before
each update; do not blindly retry a 412 with a newer token without reviewing the
intervening edit.

```sh
BASE_URL=https://octo.hexly.ai
etag=$(curl -fsS -D - -o /dev/null \
  -H "Authorization: Bearer $OCTO_API_KEY" \
  "$BASE_URL/api/v1/spaces/research" \
  | awk 'tolower($1) == "etag:" { gsub("\r", "", $2); print $2 }')
curl -fsS -X PATCH "$BASE_URL/api/v1/spaces/research" \
  -H "Authorization: Bearer $OCTO_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "If-Match: $etag" \
  --data '{"slug":"research-notes"}'
```

The response keeps the same `id`, name and description, with
`slug: "research-notes"`. `research` remains an alias for 30 days.

## MCP example

`update_space` uses `space` for the target selector and `slug` for the new value.
This replaces the old selector shape; no fallback accepts `slug` as a target.
Use `String(Date.parse(space.updated_at))` from a current `list_spaces` result
for optional `if_match` (replace the illustrative value below).

```json
{
  "name": "update_space",
  "arguments": {
    "space": "research",
    "slug": "research-notes",
    "if_match": "1792458000000"
  }
}
```

MCP preserves its normal HTTP 200 tool-error envelope; stale tokens yield
`result.isError = true` with `version_conflict`. There is no repository-side
`octo-memory` skill to update; bot callers should use this documented shape.
