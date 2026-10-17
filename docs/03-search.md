# 03 — 搜索

> 返回 [文档目录](README.md)

两个通道：**全文**（D1 FTS5 trigram）和**向量**（Vectorize，调用方自带向量），在 Worker 里做混合融合，每个结果都返回各通道的分数。2026-10-17 已对照 Cloudflare 文档核实可行性（链接见 §7）。

## 1. 全文：D1 FTS5 + trigram

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, body, tags,
  content='', contentless_delete=1,
  tokenize='trigram remove_diacritics 1'
);
-- rowid 映射：memories_fts_map(memory_id TEXT PRIMARY KEY, fts_rowid INTEGER UNIQUE)
```

- **为什么用 trigram：** `unicode61` / `porter` 按空格分词，中文整句会变成一个 token。trigram 用重叠的 3 字符窗口，中英文都能做子串匹配；Cloudflare D1 最佳实践文档也推荐用 FTS5 trigram 做任意子串搜索。
- **已知限制：** 少于 3 个字符的词没法单独靠 trigram 命中，而中文常见的二字词（如「部署」）正好在这个范围里。处理方式：
  1. 查询被切成若干词（按空白和标点分），≥3 字符的走 `MATCH`；
  2. <3 字符的词在 FTS 候选集上加 `instr(body, ?) > 0` 过滤；如果整个查询都是短词，就在调用方可见的 space 内做有上限的 `LIKE` 扫描（最多扫 N 行并标记 `partial=true`）；
  3. 实现前先做 spike，在本地 D1 上确认 trigram 分词器可用并测一下 bm25 表现（见 08 M0）。

**Spike 结论（M0，L2 隔离本地 D1，复用 `migrations/0001_core.sql`）：** wrangler `--local` 的 FTS5 `tokenize='trigram remove_diacritics 1'` 与 `contentless_delete=1` 可用。英文子串（如 `cdef`）和 ≥3 字中文（如「三个字」）都能 `MATCH`；2 字中文（如「部署」）单独 `MATCH` 为空，必须走 `instr` / 有上限 `LIKE`。contentless 表不回填 title/body 列，读结果要靠 `memories_fts_map` 的 `rowid`。`DELETE WHERE rowid=?` 在 contentless_delete 下有效。`bm25(memories_fts, 5.0, 1.0, 2.0)` 返回数值并可排序（越小越相关）。
- **排序：** `bm25(memories_fts, 5.0, 1.0, 2.0)`（title 权重高）。返回原始 bm25 和归一化分数。
- **同步：** 在写路径的 batch 中显式 delete + insert（contentless-delete 模式），不用触发器，便于测试。
- **备份注意：** D1 导出不支持包含虚拟表的库，所以备份依赖 D1 Time Travel；需要导出时先 drop FTS 再重建（脚本化，写进运行手册）。

## 2. 向量：Vectorize（调用方自带向量）

- **已决（知识库 bot，2026-10-17）：** 模型 `text-embedding-3-small`，1536 维，cosine。维度和模型是配置（`embedding_profiles`），不在代码里写死。
- 写入 memory 时可以带 `vector: { profile, values: number[] }`。服务端校验 `values.length === profile.dims`、数值有限、非零向量，**做 L2 归一化**，然后存进 D1 `memory_vectors`（归一化后的值，连同 `embedding_model`、`dim`，便于重建）并 upsert 到 Vectorize。
- **Embedding profile** = `(model, dims, metric)`。Vectorize 索引的维度在创建时就固定了，所以每个 profile 对应一个独立的索引 `octo-vec-<profile_id>`。v1 的活跃 profile 是 `te3-small-1536`（索引 `octo-vec-te3-small-1536`），绑定为 `VEC`；切换模型 = 新建索引和绑定，调用方补写向量（或由知识库 bot 重新计算），从 D1 回填，完成后切换 `active`。
- **限制（文档核实）：** ≤1536 维、float32；id ≤64 字节（ULID 26 字节）；每个索引最多 10 个 metadata index；string 只有前 64 字节可以过滤；**string 数组不能被索引或过滤**；topK 带 metadata 时 ≤50，不带时 ≤100；每个索引最多 2000 万向量。
- **Metadata（被索引的）：** `space`（string）、`type`（string）、`source`（string，key id）、`importance`（number）、`created`（number）、`updated`（number）、`event`（number）。共 7 个，在 10 个的上限内。metadata index 必须在插入向量**之前**建好，写进部署脚本。
- **tags 过滤：** Vectorize 过滤不了数组，所以先在 Vectorize 用其他条件取 topK=100（不返回 metadata），再在 D1 用 `memory_tags` 做后过滤和可见性校验。命中太少时在响应里标记 `vector_truncated=true`。
- **本地开发和测试：** Vectorize **没有本地模拟**，而 6DQ 禁止远程 `-test` 资源。所以向量访问走 `VectorStore` 端口：
  - `CloudflareVectorStore`（生产，包装 `env.VEC`），L1 用一个假 binding 测它的请求映射；
  - `D1BruteForceVectorStore`（本地 dev / L2 / L3）：从 `memory_vectors` 读取，在 Worker 内算 cosine，并实现同一套过滤语义。
  - 两个实现共用同一套契约测试。生产路径的真实行为在部署后用只读冒烟脚本验证（手动，不进门禁）。

### 2.1 向量模型设置与查询向量（dashboard）

Production index synchronization is owned by M7. The same post-commit queue
handles explicit vectors, metadata edits, trash/restore, backfill and purge;
see [the durable synchronization protocol](02-data-model.md#m7-derived-index-ownership-and-recovery).
Hourly cron retries pending vectors and performs bounded anti-entropy passes.
`indexed_at` acknowledges only a successful operation for the current generation,
never an obsolete in-flight write. A stale vector keeps its original content hash
so search can report staleness; synchronization does not fabricate an embedding.

- **配置位置：** dashboard 的「向量模型」设置页（`/settings/embedding`），只走 Access 保护的 `/api/admin/settings/embedding`，**绝不**通过 `/api/v1` 或任何 API key 暴露。
- **字段：** `base_url`、`api_key`、`model`（默认 `text-embedding-3-small`）、`dims`（默认 1536）、`backfill_enabled`（默认关）。
- **API key 的存储：** 在 D1 `settings` 表中用 AES-GCM 加密保存，master key 是 Worker secret `OCTO_SETTINGS_KEY`。只能写不能读：GET 只返回 `api_key_set: true/false` 和末 4 位掩码，从不回显明文；可以整体替换或清除。明文只在提交那次请求体和 Worker 内存中出现，不进日志。
- **「测试连接」按钮：** `POST /api/admin/settings/embedding/test` 用当前（或尚未保存的）配置嵌入一个固定短文本，返回耗时、实际维度、维度是否匹配和错误码（不返回上游原始错误）。
- **调用方式：** `QueryEmbedder` 端口，实现为 `GatewayEmbedder`：`POST {base_url}/v1/embeddings`，请求头 `Authorization: Bearer <api_key>`、`Content-Type: application/json`，并且**始终带** `User-Agent: octo/<APP_VERSION>`（网关不带 UA 会返回 403）；body `{"model", "input": [...]}`；超时 5 秒；结果校验维度后做 L2 归一化。
- **dashboard 搜索：** 查询文本经 `QueryEmbedder` 转成向量后走混合搜索。未配置或调用失败时**降级为全文 + 过滤**，响应带 `channels.vector = {skipped: "embedder_unavailable"}`，UI 显示提示条。
- **API 不变：** `/api/v1` 的写入和搜索仍由调用方自带向量，服务端不替 API 生成查询向量。
- **可选的服务端补向量（backfill）：** dashboard 里的开关，**默认关闭**。开启且配置了模型时，没有带向量的写入（v1 或 dashboard）在响应后通过 `ctx.waitUntil` 异步调用 embedder，写入 `memory_vectors`（`embedding_model` / `dim` 记为当前配置的值）并索引到 Vectorize。失败只记日志（observability + `memory_vectors` 缺失 / `indexed_at` 为空，健康页可见），不影响写入结果。补向量用的文本是 `title + "\n\n" + body`，超长部分截断。
- 配置的 `model` / `dims` 必须和活跃的 embedding profile 一致，否则保存失败（`dims` 不同意味着需要新的 Vectorize 索引，见上文的 profile 切换流程）。
- L1 / L2 使用本地 stub 网关，测试不访问真实网关；stub 会断言请求带了 User-Agent。

## 3. 过滤

所有通道都接受：

| 字段 | 语义 |
|---|---|
| `spaces[]` | 和调用方可见的 space 求交集；为空 = 所有可见 space |
| `tags_all[]` / `tags_any[]` | 全部包含 / 任一包含（规范化后比较，自动跟随合并重定向） |
| `types[]` | in |
| `sources[]` | key id in |
| `time` | `{field: created|updated|event, from?, to?}` |
| `importance` | `{min?, max?}` |

FTS 通道把过滤条件转成 SQL `WHERE`；向量通道把能下推的转成 Vectorize filter（`$in/$gte/$lte/$eq`），剩下的在 D1 后过滤。

## 4. 混合融合

请求：

```json
POST /api/v1/search
{
  "query": "部署 cloudflare worker",
  "vector": {"profile": "bge-m3-1024", "values": [/* … */]},
  "filters": {"tags_any": ["infra"], "time": {"field": "updated", "from": "2026-01-01T00:00:00Z"}},
  "mode": "hybrid",              // hybrid|fts|vector
  "fusion": {"method": "rrf", "k": 60, "weights": {"fts": 1, "vector": 1}},
  "limit": 20,
  "include": ["snippet"]
}
```

- `query` 和 `vector` 至少要有一个；`mode` 默认根据给了什么推断。
- 每个通道各取 `candidate_k = min(100, limit*5)` 个候选。
- **RRF（默认）：** `fused = Σ w_c / (k + rank_c)`；分数稳定，不依赖各通道分数的尺度。
- **weighted（可选）：** 各通道做 min-max 归一化后加权求和。
- 结果按 `fused` 降序排列，同分时按 `updated_at` 降序。

响应里的每一项：

```json
{
  "id": "01J…", "title": "…", "space": "kb-bot", "type": "procedure", "tags": ["infra"],
  "updated_at": "…", "snippet": "…<mark>部署</mark>…",
  "scores": {
    "fused": 0.0325,
    "fts": {"rank": 1, "bm25": -7.81, "normalized": 1.0},
    "vector": {"rank": 3, "similarity": 0.83, "normalized": 0.91}
  }
}
```

只被一个通道命中的结果，另一个通道的值为 `null`。响应还会附带 `channels: {fts: {candidates, partial}, vector: {candidates, truncated, profile}}`。

## 5. 一致性和权限

- 向量命中的 id 一律回 D1 校验：存在、未删除、space 可见、过滤条件全部满足。这能挡住 D1 / Vectorize 不同步造成的幽灵结果。
- 无权访问的 space：在两个通道里都以 SQL / filter 条件排除，计数里也不出现（「不可见」而不是「禁止访问」）。
- 搜索不写审计以外的任何数据。

## 6. 批量获取

`POST /api/v1/memories:batchGet {ids: [...≤100]}`：返回找到的条目，以及 `missing[]`（不存在、无权限或已删除都算 missing，不区分原因，防止探测）。

## 7. 文档依据（2026-10-17 读取）

- D1 索引最佳实践：任意子串搜索推荐 FTS5 trigram — developers.cloudflare.com/d1/best-practices/use-indexes/
- Vectorize 限制（1536 维、10 个 metadata index、64B 前缀、topK 50/100、2000 万向量）— developers.cloudflare.com/vectorize/platform/limits/
- Vectorize 不能过滤 string 数组 — developers.cloudflare.com/ai-search/configuration/retrieval/filtering/
- Vectorize 没有本地模拟（只能 remote binding）— developers.cloudflare.com/workers/local-development/
- AI Search 关键词搜索的 CJK trigram（2026-10-16 changelog）可作为备选托管方案；v1 不采用，因为它不支持调用方自带向量，过滤语义也不由我们控制。
