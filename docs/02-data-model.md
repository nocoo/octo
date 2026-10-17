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
  content_hash TEXT NOT NULL,       -- sha256(title+body)，用于去重提示和向量陈旧判断
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
4. 更新 FTS 行（由触发器或在 batch 内显式写）。
5. 追加一条 `changes`。
6. 若带了 `vector`，upsert `memory_vectors`，并把 `indexed_at` 置为 NULL。

D1 提交后，再写 Vectorize（upsert 或 delete），成功后回填 `indexed_at`。失败时 `indexed_at` 保持 NULL，由 cron 补偿重试。D1 和 Vectorize 不在同一个事务里，所以搜索时向量通道会用 D1 重新校验可见性（见 03 §5）。

## 4. 版本

- 每次 create / update / rollback / restore / move 都生成新版本。版本号从 1 开始，按 memory 自增。
- 只存完整快照，不存增量；diff 在读取时由服务端用 jsdiff 计算（行级 + 字段级）。
- 回滚 = 把旧版本复制成新版本，`op=rollback`、`rollback_of=N`；历史不改写。
- 版本永久保留。正文按平均 2 KB 估算，D1 单库 10 GB 足够用很久；容量告警放进健康页。

## 5. 标签

- 标签是全局的，不分 space。写入时规范化：trim、NFKC、拉丁字母小写，长度 1–64。
- 重命名：只改 `display_name` / `name`；有冲突时返回 409 并建议改用合并。
- 合并 A→B：在一个 batch 内把 `memory_tags` 从 A 改到 B（去重）、设置 `A.merged_into=B`、对受影响的 memory 各写一条 `changes(op=tag_merged)`。**不**生成新的 memory 版本（标签变化单独记在 change feed 里）；之后用 A 的名字写入会自动重定向到 B。
- 标签列表附带使用次数，并按调用方可见的 space 过滤计数。

## 6. 回收站

- 删除 = 设置 `deleted_at` / `deleted_by`，写 `changes(op=trashed)`，删除 Vectorize 中对应的向量（D1 里的向量原值保留，恢复时重新索引）。
- 回收站里的条目不出现在 get / list / search 中，除非显式带 `?include=trashed`（只有有 delete 权限的 key 可以）。
- 恢复：清空 `deleted_at`，生成 `op=restore` 新版本，重新索引向量，写 `changes(op=restored)`。
- **永不自动清除。** 硬删除（purge）只能在 dashboard（Access）里做：删除 memory 行、版本、标签关联、向量（D1 + Vectorize）和 R2 对象，写 `changes(op=purged)`。审计记录保留。

## 7. 变更流（增量拉取）

- `GET /api/v1/changes?cursor=…&limit=…` 按 `seq` 升序返回，只包含调用方可见 space 的事件。
- 游标是不透明的 base64url（`{"s":<seq>}`）。客户端只能把它原样传回。
- 删除类事件（trashed / purged）只带 id，不带正文。
- 新客户端的初始同步：先 `GET /api/v1/changes/head` 拿当前游标，再分页 list 全量，最后从 head 开始拉增量。

## 8. R2 键

- `att/<memory_id>/<attachment_id>`；对象 metadata 存 `sha256`、`content_type`。
- 上传经过 Worker（单个附件 ≤ 50 MB，低于 Workers 付费版的请求体上限）。下载用**短时签名 URL**：鉴权后的 `GET /attachments/:id/url` 返回 `…/files/<r2_key>?exp=<unix>&sig=<HMAC-SHA256(ATTACHMENT_URL_SECRET, r2_key|exp)>`，有效期默认 5 分钟；校验签名后从 R2 流式返回。现在由 Worker 的 `/files/*` 路由校验；以后 Zheng 配好 CDN 域名，只需要把 URL 的 host 换成 CDN 域名，由 CDN 侧一个很薄的 Worker 用同一个 secret 校验，客户端不用改。
