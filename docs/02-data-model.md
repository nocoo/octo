# 02 — 数据模型

> 返回 [文档目录](README.md)

D1 `octo-db` 是唯一的权威数据源。迁移只做加法（additive）；回滚靠代码兼容和 D1 Time Travel。时间字段一律是 UTC 毫秒整数。

## 1. 实体关系

```
spaces 1─* memories 1─* memory_versions
memories *─* tags            (memory_tags)
memories 1─* attachments     (R2 对象)
memories 1─* memory_vectors  (每个 embedding profile 一行)
changes                      (全局单调变更流)
api_keys 1─* audit_log
idempotency_records
usage_daily
```

## 2. 表结构（草案 DDL）

```sql
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,              -- ULID
  slug TEXT NOT NULL UNIQUE,        -- 人可读，如 "kb-bot"
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_key_id TEXT,                -- 「仅自己的 space」中的拥有者 key
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,              -- ULID
  space_id TEXT NOT NULL REFERENCES spaces(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,               -- Markdown
  type TEXT NOT NULL,               -- fact|preference|decision|procedure|event|log|note…（服务端白名单，可扩展）
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  source_key_id TEXT NOT NULL,      -- 创建者 key（agent 身份）
  updated_by_key_id TEXT,
  event_time INTEGER,               -- 可选：事件发生时间
  version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,       -- sha256(JSON.stringify([title, body])); deduplication hint and vector provenance
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,               -- 非空 = 在回收站
  deleted_by TEXT
);
CREATE INDEX memories_space_updated ON memories(space_id, updated_at);
CREATE INDEX memories_deleted ON memories(deleted_at);
CREATE INDEX memories_type ON memories(type);
CREATE INDEX memories_event_time ON memories(event_time);

CREATE TABLE memory_versions (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  importance REAL NOT NULL,
  tags_json TEXT NOT NULL,          -- 该版本的标签快照（规范化名称数组）
  event_time INTEGER,
  space_id TEXT NOT NULL,
  actor TEXT NOT NULL,              -- key:<id> 或 admin:<email>
  op TEXT NOT NULL,                 -- create|update|rollback|restore|move
  rollback_of INTEGER,              -- op=rollback 时为源版本号
  created_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, version)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,        -- 规范化：trim、NFKC、小写（仅拉丁字母），保留中文
  display_name TEXT NOT NULL,
  merged_into TEXT REFERENCES tags(id), -- 合并后保留别名以重定向
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE memory_tags (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (memory_id, tag_id)
);
CREATE INDEX memory_tags_tag ON memory_tags(tag_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id),
  r2_key TEXT NOT NULL UNIQUE,      -- att/<memory_id>/<attachment_id>
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,       -- 白名单：image/png|jpeg|webp|gif|svg+xml(净化)、application/pdf
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE embedding_profiles (
  id TEXT PRIMARY KEY,              -- 如 "te3-small-1536"（v1 种子：text-embedding-3-small / 1536 / cosine）
  model TEXT NOT NULL,
  dims INTEGER NOT NULL CHECK (dims BETWEEN 1 AND 1536),
  metric TEXT NOT NULL DEFAULT 'cosine',
  vectorize_index TEXT NOT NULL,    -- 对应 wrangler 绑定的索引名
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE memory_vectors (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  profile_id TEXT NOT NULL REFERENCES embedding_profiles(id),
  embedding_model TEXT NOT NULL,    -- 冗余记录，如 text-embedding-3-small（重建用）
  dim INTEGER NOT NULL,             -- 冗余记录，如 1536
  vector BLOB NOT NULL,             -- L2 归一化后的 float32 小端，长度 = dim*4
  content_hash TEXT NOT NULL,       -- 生成该向量时 memory 的 content_hash
  indexed_at INTEGER,               -- 写入 Vectorize 成功的时间；NULL = 待同步
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, profile_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,             -- 如 embedding.base_url / embedding.model / embedding.dims / embedding.backfill_enabled / embedding.api_key
  value TEXT,                       -- 明文配置值；敏感项为 NULL
  ciphertext BLOB,                  -- 敏感项：AES-GCM（OCTO_SETTINGS_KEY）密文
  iv BLOB,
  key_version INTEGER,              -- master key 版本，便于轮换
  updated_by TEXT NOT NULL,         -- admin:<email>
  updated_at INTEGER NOT NULL
);

CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, -- 全局单调，游标基础
  entity TEXT NOT NULL,             -- memory|tag|space|attachment
  entity_id TEXT NOT NULL,
  space_id TEXT,                    -- 用于按权限过滤
  op TEXT NOT NULL,                 -- created|updated|trashed|restored|purged|rolled_back|moved|tag_renamed|tag_merged
  version INTEGER,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX changes_space_seq ON changes(space_id, seq);

CREATE TABLE idempotency_records (
  key_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,           -- 客户端 Idempotency-Key，≤128 字符
  request_hash TEXT NOT NULL,       -- sha256(method+path+规范化 body)
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (key_id, idem_key)
);
```

`api_keys`、`audit_log`、`usage_daily` 见 [05](05-auth-permissions-audit.md)。FTS 虚拟表见 [03](03-search.md)。

## 3. 写路径不变量

每次修改 memory 时，**同一个 D1 `batch()`**（隐式事务）里完成：

1. 更新 `memories` 行（乐观并发：`WHERE id=? AND version=?`；不匹配返回 409 `version_conflict`）。
2. 插入新的 `memory_versions` 行（完整快照）。
3. 更新 `memory_tags`。
4. 显式更新 trigram 与预分词 FTS 行、标签分词数据；与 memory、版本、change event 同批提交。
5. 追加一条 `changes`。
6. 若带了 `vector`，upsert `memory_vectors`，并把 `indexed_at` 置为 NULL。

D1 提交后，再写 Vectorize（upsert 或 delete），成功后回填 `indexed_at`。失败时 `indexed_at` 保持 NULL，由 cron 补偿重试。D1 和 Vectorize 不在同一个事务里，所以搜索时向量通道会用 D1 重新校验可见性（见 03 §5）。

### M7 derived-index ownership and recovery

M7 owns the production synchronizer, not M6 or the dashboard. An additive
`vector_sync_jobs` table durably records each memory's desired generation. D1
triggers enqueue vector changes and indexed metadata changes inside the original
write transaction, invalidate `indexed_at`, and retain a deletion tombstone after
purge. No external call occurs while preparing or committing memory SQL.

After a successful HTTP/MCP commit, `waitUntil` synchronizes that write's memory
IDs through the `VectorStore` port, independently of the global cron backlog.
Batch writes collect only successful staged IDs; rollback removes staged IDs,
and no-op/idempotent replays schedule no memory work. A D1 lease serializes work for each memory; the worker
reads the current active-profile vector and metadata, upserts live vectors, and
deletes missing/trashed/content-stale vectors. The Vectorize ID is exactly the
memory ID (one vector per memory, no generation suffix or chunk IDs). Upserts
include `generation` and `content_hash` metadata. Only the claimed generation may acknowledge
`indexed_at`. A concurrent mutation can be reclaimed within the same drain,
with at most three generation-repair rounds per selected job. Vectorize rate limits
(40041, HTTP 429, or throttling messages) receive two in-run retries with jittered
100–200 ms and 200–400 ms delays. Exhaustion releases the claim for retry after
60–120 seconds without incrementing attempts or approaching the dead state, and
emits `vector_sync_rate_limited` with the same redacted diagnostics. Other provider
failures are not retried in-run: migration `0007_vector_sync_retries.sql` persists
`attempts`, redacted `last_error`, and `dead_at`. Each failure increments attempts
and sets `due_at = now + min(2^attempts, 24) hours` (first retry after two hours).
The eighth consecutive failure parks the job with `dead_at`, excludes it from
selection/claims, and emits `vector_sync_dead` once for that transition. Success
clears retry state. A new authoritative memory/vector/space-slug mutation resets
the failure budget and revives the job; an expired or stale completion cannot
consume a newer generation's budget or clear its backoff. HTTP writes, MCP writes
and cron use this same path.
The `lease_dirty` flag records a stale external completion while a newer lease
is active. It forces successful work to reconcile again without changing that
owner's authoritative generation or losing its failure budget. Claims clear
the flag; real source mutations still advance the generation and reset retries.
Failures emit structured `vector_sync_failed` logs with the memory ID, an
allowlisted error name/code, a fixed stage-specific message, and `error_message`
limited to 300 characters. Message redaction retains only known public Vectorize
error prefixes, numeric provider codes, and standard transport/status phrases;
all other text is replaced with `[redacted]`. Unknown codes/names, response bodies,
credentials and stacks are never logged. This deliberately favors privacy over
free-form provider detail.
Completed jobs and purge tombstones retain their acknowledged generation but
are excluded from selection and claims until generation invalidation. Existing
rows with legacy hourly deadlines are also excluded. Migration
`0011_vector_profile_invalidation.sql` invalidates vectors and requeues memories
when an active profile is inserted, removed, or changes model, dimensions,
activation or index. Memory/vector/space triggers cover writes, moves, restores
and slug changes; stale completions explicitly invalidate their destinations.
A provider mutation followed by a process crash still has a non-transactional
recovery gap: periodic rewriting is intentionally removed, not a fencing guarantee.
D1 visibility checks remain mandatory and continue independently of pending jobs.
Cron selects 50 jobs by default (explicit limits are capped at 500); write drains
select their supplied memory IDs, without bypassing backoff or live leases. Both use a 60-second lease.
Failed work is moved behind untouched due work, so a
persistently failing prefix cannot starve later updates or purge tombstones.
Claiming a lease also advances its queue position before the external call;
an abandoned or hung call therefore cannot reclaim the queue head forever.
The same claim covers embedding backfill before any gateway call. At most four
jobs are claimed together; current client vectors and deletion tombstones bypass
embedding preparation. Only missing/stale live vectors form an embedding batch;
distinct missing content hashes share one gateway request and identical hashes
share one input. Another drain skips their live leases. If preparation rejects,
every claim in that embedding batch takes the durable failure path, without
charging already-ready vector writes or deletions. After backfill, synchronization rechecks
lease ownership and reads the current generation before reading the vector;
an expired owner's completion cannot acknowledge a newer owner's work.
Each actual claim and post-backfill refresh reads the current clock, rather than
reusing the drain start time. A queued delete refreshes and checks its lease and
generation immediately before joining the provider batch; superseded claims are
not sent. Retry delays start from failure time.
Completed rows and tombstones are intentionally retained; this is the durable
recovery cost of a destination without conditional/fenced writes.

Deletes are grouped into `deleteByIds` chunks of at most 100 IDs. A rejected
chunk defers only its own jobs; other chunks acknowledge independently. Successful
chunks acknowledge each generation separately, repairing concurrent restores
without repeating successful unrelated deletes. `OCTO_VECTOR_SYNC_CONCURRENCY`
accepts positive integers, capped at four; absent, fractional or invalid values
use four. The local workerd harness sets it to `1` and awaits test post-commit
work to avoid drain deadlocks. The old inverted parallel flag is removed.

Apply migration `0010_vector_convergence.sql` before deploying this worker version.
It adds nullable `vector_sync_jobs.visible_generation`, `embedding_cache`
(hash key, model, dimensions, vector, lease token/expiry and update time), and
`memory_embedding_calls` (memory/profile primary key and outbound participation
count). Cached text is not stored separately. The cache survives a stale memory
CAS; cache hits, retries and requeues never repeat a successful embedding request.
All final memory-vector writes in a preparation batch commit atomically after
generated embeddings have been cached. Cache claim conflicts and gateway/config/
storage failures reject, rather than acknowledging an absent vector.

`indexed_at` means Vectorize accepted the current-generation upsert, not that
Vectorize queries can see it. A self-vector query must return the same ID,
generation and content hash before `visible_generation` advances. Visibility
checks also run for accepted pending generations without repeating an upsert.
Until then, search reads the current D1 vector through a bounded-memory overlay;
there is no time-based expiry. See [the convergence contract](vector-convergence.md).

Inspect dead work with
`SELECT memory_id, attempts, last_error, dead_at FROM vector_sync_jobs WHERE dead_at IS NOT NULL`.
After fixing the provider, an authorized operator can explicitly retry dead rows
with `UPDATE vector_sync_jobs SET attempts = 0, last_error = NULL, dead_at = NULL, due_at = 0 WHERE dead_at IS NOT NULL`.
This is not automatic purge or a client-facing API; it neither deletes D1 vectors
nor changes authoritative memories. Do not run operational SQL against production
without separate authorization.

The local D1 brute-force adapter already reads the authoritative state, so its
write-port operations do not mutate or delete the source vectors. Tests exercise
the same synchronizer with this adapter and controlled fake ports, never remote
Vectorize. Backfill writes a guarded vector to D1, then uses this same queue;
client-provided vectors and newer memory revisions must not be overwritten.
Purge atomically removes D1 data and records R2 cleanup work; failed external
cleanup remains retryable without resurrecting the memory or deleting audit.
R2 cleanup is bounded to 100 objects per drain and orders retries by last
attempt, so repeatedly failing older objects do not starve newer purges.
The attempt timestamp is persisted before calling R2, including calls whose
process never reaches a catch handler.

## 4. 版本

- `If-Match` / `expected_version` 接受非负整数；0 是有效但必不匹配的版本前提，返回 409 `version_conflict`，不是 400。存储版本仍从 1 开始。
- 当前记录及版本快照的 `importance` 均由写入 schema 限定为 0–1（含端点）。
- 每次 create / update / rollback / restore / move 都生成新版本。版本号从 1 开始，按 memory 自增。
- 标签数组的顺序属于版本内容：仅重排标签也生成新版本，diff 返回 `tags` 字段的前后数组；未提交标签的更新保持当前顺序。
- 只存完整快照，不存增量；diff 在读取时由服务端用 jsdiff 计算（行级 + 字段级）。
- 回滚 = 把旧版本复制成新版本，`op=rollback`、`rollback_of=N`；历史不改写。
- 版本永久保留。正文按平均 2 KB 估算，D1 单库 10 GB 足够用很久；容量告警放进健康页。

## 5. 标签

- 标签是全局的，不分 space。写入时规范化：trim、NFKC、拉丁字母小写，长度 1–64。
- 标签按调用方顺序规范化、解析合并别名并去重，保留第一次出现的位置。`memory_tags.position` 存储顺序，CRUD、list、search、batchGet 和版本快照均保留此顺序。重命名不移动位置；合并时重复标签保留两者最靠前的位置。
- 加法式迁移 `0006_tag_positions.sql` 增加 `position` 并按旧 API 的名称字典序初始化既有关系，不删除数据、不改写历史版本。历史快照保留原数组；回滚后按该快照顺序写入新版本。
- 重命名：只改 `display_name` / `name`；有冲突时返回 409 并建议改用合并。
- 合并 A→B：在一个 batch 内把 `memory_tags` 从 A 改到 B（去重）、设置 `A.merged_into=B`、对受影响的 memory 各写一条 `changes(op=tag_merged)`。**不**生成新的 memory 版本（标签变化单独记在 change feed 里）；之后用 A 的名字写入会自动重定向到 B。
- API key 的标签列表（REST / MCP）只返回至少被一个可见 space 内未删除 memory 使用的标签，`use_count` 也只统计这些引用；没有可见空间时返回空列表。Access 后台保留完整全局标签字典（包括零引用标签），计数仍只统计未删除 memory。
- 零引用标签不自动删除。`DELETE /api/v1/tags/:name` 要求 `scope=all` 且有 `u`，只删除指定名称；全局仍有 memory 引用（包括回收站）或其他标签的合并别名指向它时返回 409 `tag_in_use`。必须先显式删除无引用的叶子别名，不能产生悬空重定向或隐式级联删除。检查与删除在同一 D1 写事务中重验，所有调用写入审计，不生成无所属空间的公共变更事件。清理步骤见 [标签清理手册](tag-cleanup.md)。

## 6. 回收站

- 删除 = 设置 `deleted_at` / `deleted_by`，写 `changes(op=trashed)`，删除 Vectorize 中对应的向量（D1 里的向量原值保留，恢复时重新索引）。
- 回收站里的条目不出现在 get / list / search 中，除非显式带 `?include=trashed`（只有有 delete 权限的 key 可以）。
- 恢复：清空 `deleted_at`，生成 `op=restore` 新版本，重新索引向量，写 `changes(op=restored)`。
- **永不自动清除。** 硬删除（purge）只能在 dashboard（Access）里做：删除 memory 行、版本、标签关联、向量（D1 + Vectorize）和 R2 对象，写 `changes(op=purged)`。审计记录保留。

## 7. 变更流（增量拉取）

- `GET /api/v1/changes?cursor=…&limit=…` 按 `seq` 升序返回，只包含调用方可见 space 的事件。
- 游标是不透明的 base64url（`{"s":<seq>}`）。客户端只能把它原样传回。
- 删除类事件（trashed / purged / moved_out）只带 `seq,entity,entity_id,op,at`，不带正文、空间、版本或 actor。
- 跨空间写入在同一 D1 batch 内先写原空间 `moved_out` 墓碑，再写目标空间 `moved`（或跨空间 rollback 的 `rolled_back`）。旧空间消费者据此移除本地副本，不获知目标空间；两侧可见的消费者按序处理。既有 `changes.space_id` 足以表达两侧事件，无需新增迁移。
- 新客户端的初始同步：先 `GET /api/v1/changes/head` 拿当前游标，再分页 list 全量，最后从 head 开始拉增量。

## 8. R2 键

- `att/<memory_id>/<attachment_id>`；对象 metadata 存 `sha256`、`content_type`。
- 上传经过 Worker（单个附件 ≤ 50 MB，低于 Workers 付费版的请求体上限）。下载用**短时签名 URL**：鉴权后的 `GET /attachments/:id/url` 返回 `…/files/<r2_key>?exp=<unix>&sig=<HMAC-SHA256(ATTACHMENT_URL_SECRET, r2_key|exp)>`，有效期默认 5 分钟；校验签名后从 R2 流式返回。现在由 Worker 的 `/files/*` 路由校验；以后 Zheng 配好 CDN 域名，只需要把 URL 的 host 换成 CDN 域名，由 CDN 侧一个很薄的 Worker 用同一个 secret 校验，客户端不用改。
