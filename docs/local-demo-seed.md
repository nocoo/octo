# Local demo seed

Start `bun run dev` in the persistent Herdr dev-server tab, then run:

```sh
bun run seed:demo
```

Open <https://octo.dev.hexly.ai>. The default memory page size is 50: a fresh
import provides 84 active memories (50 + 34) and another 6 in the trash.
The checked-in catalogue lives in `scripts/seed-demo-data.ts`.

## What to exercise

- Six spaces: an urban garden, creative studio, kitchen, trails, repair workshop,
  and reading room. Filter by space or combine their shared tags.
- All seven memory types, importance boundaries and defaults, dated and undated
  events, English/Chinese/mixed text, emoji, long titles, and empty/long bodies.
- Markdown tables, lists, quotations, fenced code, and inert example links.
- Updated memories with version history and diffs, downloadable SVG attachments,
  and six soft-deleted memories for restore and trash journeys.
- Full-text search, tag combinations, date ranges, pagination, and bulk selection.

The data is synthetic and contains no real credentials or personal information.
It does not contain generated embeddings: missing-vector states are intentional.
This seed does not validate semantic retrieval. Configuring an embedding gateway
and enabling backfill is a separate, explicit action that can send text externally.

## Safety and repeat runs

The importer uses only the fixed loopback Worker at `127.0.0.1:37059`, refuses
redirects, and sends the development admin Origin. It validates the generated
local Wrangler configuration and the healthy non-test database before importing.
Embedding backfill must be explicitly disabled; the script never changes that
setting or reads, writes, or logs API keys. No remote target or reset flag exists.

Writes use the normal admin API, so memory transactions maintain version
snapshots, tags, FTS, change events, and audit records; attachments use local R2.
The importer does not write SQL or bypass application invariants.

The six `demo-*` slugs are reserved for this catalogue. A pre-existing space with
a different description blocks the import before any writes. Repeat runs match
memories by space and title, including the trash, and skip matching records
without overwriting edits, attachments, or restored/deleted state. Renaming or
moving a seeded memory makes the original identity eligible for creation again.
Hard-deleting a seeded record likewise allows its recreation on the next run.

An interrupted run can leave a partially populated catalogue; completed records
remain intact and rerunning adds missing identities. Existing identities are not
repaired: if interruption occurred between creating a memory and its revision,
attachment, or trash action, finish that optional step through the dashboard.
The seed never clears the database or deletes unrelated local data.

All persistence remains in the daily development `.wrangler/state` directory.
Do not use the L2/L3 test persistence directories or copy production credentials.
