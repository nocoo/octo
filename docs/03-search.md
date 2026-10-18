# 03 — 搜索

> 返回 [文档目录](README.md)

两个通道：**全文**（D1 预分词 FTS5，保留 trigram 子串补充）和**向量**（Vectorize，调用方自带向量）。FTS 的相关性分数仍是实际 BM25；跨通道继续使用 RRF 或加权融合。

## 1. 全文：共享分词与独立 token

迁移 `0008_word_search.sql` 新增 `memories_words_fts(title, body, tags)`，使用 `unicode61 remove_diacritics 1`，与既有 trigram 表共用 `memories_fts_map` rowid。新表保存分词后的文本，允许标签改名/合并在同一 D1 事务内仅重写 tags，不需要读出正文再做有竞态的异步重建。原始 title/body、版本和 content hash 不变。

### 分词规则

- 写入与查询均用原生 `Intl.Segmenter("zh", {granularity: "word"})`；不做会放大正文的兼容归一化，直接拆分汉字和非汉字连续段。因此「为什么选D1」得到「选 / D1」，不再保留混写整块。
- 相邻、连续且均非停用词的两个单字汉字 token 合为双字词，例如 ICU 的「密 / 钥」和「周 / 会」。不跨空格、标点或被移除的疑问词连接，避免把「周末开会」当作「周会」。
- 写入在词 token 外补充去重的汉字单字，不跨标点。这样查询「喝」能匹配正文的「只喝」，而非要求「早上喝」在正文中连续出现。补充 token 去重，原词频保留。
- 查询移除固定中英文虚词与疑问词，包括「什么时候、在哪、哪里、哪儿、几、多少、是不是、有没有、请问」等；「几岁」按「几 / 岁」处理，保留内容词「岁」。完整表在 tokenizer.ts。若全被移除，恢复原始分词；不返回任意记录。完整词边界保留「有机、在场、是非、目的地」等内容词。未实现词干化、同义词、语义推理或否定识别。
- unicode61 的大小写及变音符归一化同时适用于短词和长词，例如 é 与 e 的匹配不再因是否走短词扫描而不同。原文读取不变。

### 召回与排序

1. 在满足权限及所有过滤条件的词索引上用全部 token 的 **AND** 查询，按 `bm25(..., 5.0, 1.0, 2.0)` 排序、id 确定性破同分，最多返回 candidateK。
2. 若无结果且全部 token 均能使用 trigram（去除其支持的变音符后至少 3 个码点），尝试 trigram AND，以保留英文子串及词形差异，例如 drink / drinks。
3. 若仍为空且包含双汉字词，用单字 token 的 AND 从词索引取候选，并在 SQL 的 LIMIT **之前**校验该双字词连续出现在原始 title、body 或同一个规范标签名中。其他词仍要求词级匹配。这能召回「周会议程」中的「周会」和「咖啡豆」中的「咖啡」，不接受「周末开会」、跨字段或跨标签拼接。验证只处理索引匹配项，不截断到最新记录。
4. 所有严格查询均为空才用 **OR**，仍依次尝试词索引、符合长度要求的 trigram、带连续性校验的单字索引。OR 是避免自然问句中一个额外内容词导致零召回的显式放宽，不会挤掉已有 AND 结果。
5. 不直接相加不同 tokenizer 的 BM25。一次查询选择第一个有结果的检索层，保留该层的真实 BM25，再与向量通道融合。所有层都在 SQL 内重复应用 space、trash、owner、tag 等过滤；最终内容读取再次校验权限。

已删除最新 500 行 LIKE 扫描与 LIMIT 后的短词过滤。1–2 字查询直接走全量词索引，不按更新时间裁掉旧记录；双字补充路径的 instr 校验位于 LIMIT 前。candidateK 仍是相关性候选上限，不是数据扫描窗口。公开响应保留 `partial`、`partial_reason` 字段，分别为 false、null；已废弃 short_term_scan_limit 原因。上线回填完成状态由管理员回填响应的 complete 表示，不用旧扫描标志代替索引初始化状态。

### 存量回填

每次 cron 或 `POST /api/admin/settings/search/backfill` 处理最多 100 个 tag/memory，正文输入通常不超过 1 MiB；单条超过预算时仍处理这一条以保证前进。先填标签 token，再按 memory id 游标处理非回收站记录。游标在 D1 中持久化，每个阶段的数据与检查点同批提交；重复、重启、并发触发不会倒退。回填用版本及 updated_at 条件保护，不能覆盖并发新写入。新建、更新、移动、回滚、恢复与词索引同批；trash/purge 同批删除词索引；无变化更新不会为补索引产生写入。

运行步骤和 50k 本地基准见 [Round 3 验证](round3-validation.md)。迁移只加表，不在迁移 SQL 中全表同步分词，也不在请求热路径扫描历史记录。上线期间旧记录可能尚未进入词索引；先完成回填并确认 complete=true，再宣布历史短词召回已可用。

## 2. 向量：Vectorize（调用方自带向量）

- **已决（知识库 bot，2026-10-17）：** 模型 `text-embedding-3-small`，1536 维，cosine。维度和模型是配置（`embedding_profiles`），不在代码里写死。
- 写入 memory 时可以带 `vector: { profile, values: number[] }`。服务端校验 `values.length === profile.dims`、数值有限、非零向量，**做 L2 归一化**，然后存进 D1 `memory_vectors`（归一化后的值，连同 `embedding_model`、`dim`，便于重建）并 upsert 到 Vectorize。
- **Embedding profile** = `(model, dims, metric)`。Vectorize 索引的维度在创建时就固定了，所以每个 profile 对应一个独立的索引 `octo-vec-<profile_id>`。v1 的活跃 profile 是 `te3-small-1536`（索引 `octo-vec-te3-small-1536`），绑定为 `VEC`；切换模型 = 新建索引和绑定，调用方补写向量（或由知识库 bot 重新计算），从 D1 回填，完成后切换 `active`。
- **限制（文档核实）：** ≤1536 维、float32；id ≤64 字节（ULID 26 字节）；每个索引最多 10 个 metadata index；string 只有前 64 字节可以过滤；**string 数组不能被索引或过滤**；topK 带 metadata 时 ≤50，不带时 ≤100；每个索引最多 2000 万向量。
- **Metadata（被索引的）：** `space`（string）、`type`（string）、`source`（string，key id）、`importance`（number，0–1）、`created`（number）、`updated`（number）、`event`（number）。共 7 个，在 10 个的上限内。metadata index 必须在插入向量**之前**建好，写进部署脚本。
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
Backfill uses at most 16,000 characters of `title + "\n\n" + body`, then
conditionally stores the vector against the observed content, version, active
profile and complete settings snapshot. It preserves source ownership and
history. Gateway requests have a five-second timeout and reject redirects.
URL validation rejects literal nonpublic addresses and local hostnames in
production; it cannot eliminate DNS rebinding by a configured public hostname.
`indexed_at` acknowledges only a successful operation for the current generation,
never an obsolete in-flight write. A stale vector keeps its original content hash
so search can report staleness; synchronization does not fabricate an embedding.

- **配置位置：** dashboard 的「向量模型」设置页（`/settings/embedding`），只走 Access 保护的 `/api/admin/settings/embedding`，**绝不**通过 `/api/v1` 或任何 API key 暴露。
- **字段：** `base_url`、`api_key`、`model`（默认 `text-embedding-3-small`）、`dims`（默认 1536）、`backfill_enabled`（默认关）。
- **API key 的存储：** 在 D1 `settings` 表中用 AES-GCM 加密保存，master key 是 Worker secret `OCTO_SETTINGS_KEY`。只能写不能读：GET 只返回 `api_key_set: true/false` 和末 4 位掩码，从不回显明文；可以整体替换或清除。明文只在提交那次请求体和 Worker 内存中出现，不进日志。

`OCTO_SETTINGS_KEY` is a canonical base64 encoding of exactly 32 random bytes.
The all-zero value in `dev.vars.example` is a public local-development fixture,
not a production secret. Production provisioning must supply an independent
random key. Malformed keys fail closed; there is no password derivation fallback.
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
| `importance` | `{min?, max?}`，上下限均为 0–1（含端点）的数值 |

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

只被一个通道命中的结果，另一个通道的值为 `null`。响应还会附带 `channels: {fts: {candidates, partial, partial_reason}, vector: {candidates, truncated, profile}}`。

`channels.fts.partial_reason` 在 REST 和 MCP 中都是必返字段，固定为 null；`partial` 固定为 false，旧的 500 行扫描路径已经删除。candidateK 与最终 limit 仍限制返回数量，false 不承诺返回所有匹配。存量索引初始化状态见管理员 backfill 响应的 complete。

## 5. 一致性和权限

- 向量命中的 id 一律回 D1 校验：存在、未删除、space 可见、过滤条件全部满足。这能挡住 D1 / Vectorize 不同步造成的幽灵结果。
- **已知限制：Vectorize 最终一致。** D1 写入成功、同步任务已提交，甚至 Vectorize upsert 成功，都不保证新向量立即可被查询。在写入后的传播窗口内，相同查询的向量候选数可能不同（例如先返回 5 条、稍后返回 11 条），混合搜索的结果及排序也可能随之变化；`channels.vector.candidates` 是本次经 D1 重新校验后的候选数，不是符合条件的记忆总数。D1 校验能排除已删除、已移出可见空间或不再满足过滤条件的旧命中，但不能找回尚未被 Vectorize 召回的新向量；需要立即读取刚写入的数据时使用 GET / batchGet，不能把即时搜索漏项当作写入失败后重建。传播收敛前不承诺重复查询的候选数或排序稳定，本地 D1 暴力向量适配器也不模拟此延迟。
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
- Workers Intl 标准 API：[Web standards](https://developers.cloudflare.com/workers/runtime-apis/web-standards/)；中文 `Segmenter` 的具体边界以上述两个本地运行时实测为准，不把本地探针当作生产部署验证。
