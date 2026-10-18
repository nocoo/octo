# 中文词索引基准

## 当前状态与最终结果

**已完成，运行时已释放；不是仍在运行的部分结果。**
本轮仅执行一次，保留原 session `14914` 直至退出码 0，没有重启。
开始：`2026-10-18T14:47:31.635Z`（22:47:31）；结束：`2026-10-18T14:53:50.789Z`（22:53:50）。
Miniflare 完成释放后才写入 `complete`；监听地址 `http://127.0.0.1:57356/`
随后确认已拒绝连接。主控可恢复重型 gates。

最终原始证据：[2026-10-18T14-47-31-635Z-CxvmqE.json](results/2026-10-18T14-47-31-635Z-CxvmqE.json)。
状态、归档清单及 supersession 信息：`results/word-search-status.json`。
所有查询各保留 5 次预热和 30 次测量；两组写入各保留 5 个预热批次、
30 个按 round 配对的正式批次和全部差值，没有删样本。

| 证据类别 | 查询 | 墙钟 p50/p95 ms | D1 p50/p95 ms |
| --- | --- | ---: | ---: |
| 真实产品语料查询 | `备份` | 112.42 / 156.17 | 69.00 / 105.00 |
| 真实产品语料查询 | `项目 migration 发布` | 120.18 / 306.46 | 79.00 / 126.00 |
| 人工路径夹具 | `云桥` | 67.76 / 103.98 | 3.00 / 4.00 |

**「云桥」仅是人工路径选择夹具。** 该目标的有效整词 token 被故意从种子词索引中去掉，
所以该目标没有完整的产品词索引，不是自然产生的 ICU 索引，也不能证明原生上下文分词行为。
它只能验证此人工条件下的实际 SQL 路径、索引单字召回、原文连续性检查及 LIMIT 顺序。
真实产品基准是必需的「备份」、多词语料查询和正常配对写入。
原生上下文召回由主控独立 workerd 测试（`周会议程` / `咖啡豆`）验证，不冒充本轮证明。

人工目标有 49,898 条更新记录；整词命中数为 0，
单字候选 101 条，未验证的前 50 条没有目标。
全部 35 个样本均为第一条 SQL 返回 0 行、第二条在 LIMIT 前验证原文并仅返回目标。
咖啡哨兵在 49,999 条更新记录之外，对三种原有问题仍排名第一；旧最新 500 条扫描漏项。

| 每批 20 条正常写入 | trigram p50/p95 ms | trigram + words p50/p95 ms |
| --- | ---: | ---: |
| 主机准备（含 IPC） | 1132.20 / 2515.32 | 1720.45 / 4007.83 |
| db.batch 墙钟 | 114.39 / 286.16 | 155.53 / 458.65 |
| D1 耗时总和 | 47.00 / 166.00 | 83.00 / 287.00 |
| 准备 + 批次 | 1187.23 / 2758.17 | 1848.18 / 4453.95 |

总耗时中位数比值为 +55.67%，其中含主机 `prepare`/`bind` 代理 IPC，
不能称为固有生产写入开销或纯分词成本。写入记录未经过人工缺词处理。

50k 数据的 D1 已用空间：149,262,336 / 212,815,872 字节
（142.35 / 202.96 MiB），差值 63,553,536 字节（60.61 MiB）。
50,700 条数据时，trigram shadow tables 分配 71,491,584 字节，
词索引 shadow tables 分配 64,479,232 字节（61.49 MiB）。
两库 memory/version/tag/map/trigram/change 均为 50,700 行；词索引新库 50,700 行、基线 0 行，
映射孤儿数为零。空间值反映包含人工夹具的这一份数据，不能宣称目标词索引完整。
逐表行数、payload、空闲页、主文件及 WAL 字节均在 JSON。

源 HEAD 起止：`d6306840c551096abb7b32d994f3b878f3807dcf`，有工作区修改；不能把它视为干净 HEAD 的性能。
冻结模块 SHA-256：`5253fd2e7798e000dff3a6b9b71d0048206f48fa50c1d96927b0ac8eee8ca939`。
`fts-channel.ts`：`959a39b8a0ce62aeebfe08e746208120854fac94ccc8bc530f0a1291a9b83604`。
`tokenizer.ts`：`2ce534d035c919d2eb72a577a82628aab7b5fe213ea63f297a871598c1ae1ff3`。
结束后核对当前 tokenizer/channel/word-index 及三个基准源码与冻结哈希一致。

一分钟负载（开始、种子完成、查询完成、结束）：6.74, 7.98, 9.21, 35.60。
查询结束时可用内存仅 137,461,760 字节，后台负载和内存压力并未受控。
不能把历史墙钟变化全部归因于源码，更不能作为生产 SLA。

本轮完成后仅补充了人工夹具的语义元数据，未改源码、原始行或样本。
标注前原始字节副本保留在该轮持久化目录的 `raw-capture-before-labeling.json`，
SHA-256 为 `346787c3639bd715c6f165dbe878cca522ef3bd96f18b619865240e4b4eea6e0`。发布前将源码哈希从以文件名为键的对象改为 `{path, sha256}` 数组，避免把 `api-key.ts` 的文件摘要误识别为凭据；没有增加扫描豁免。最终仓库 JSON SHA-256 为 `0b17e141e47e2573be67e5c215e0ca0e155e33a0d4b99bdcd4fd2048dbabe680`。三份改格式前的逐字节副本、前后哈希和往返等价校验记录在状态清单的 `source_manifest_publication`；还原对象形式后可核对原测量/source 投影哈希。基准程序只调整出处序列化及局部标识符，实测产品源码、输入、SQL 和样本不变。
测量行、来源、环境等受保护字段的规范化哈希在修改前后相同：`43e456359defe7bd7b61bd4906b4a371139f5508b85949c0b6c489c4940323b2`。

## 复现与隔离

下面的命令只能在主控明确授权 RUN、确认没有重型任务重叠后执行：

```sh
BENCH_ROWS=50000 BENCH_WARMUPS=5 BENCH_SAMPLES=30 bun benchmarks/word-search.ts
```

每轮只启动一个 Miniflare 实例，内含两个独立的本地 D1 数据库。
持久化目录为独占的 `.wrangler/bench-word/<时间戳>-<随机后缀>/`，
仅监听系统分配的 localhost 临时端口，不使用日常开发或 L2/L3 端口。
创建并验证 `_test_marker(env=test)` 后才应用本地迁移或写入夹具，
各写入阶段重新验证 marker。全部迁移在两个对照库分别应用。
直接使用 `getD1Database`，不启动 Wrangler CLI，不读取生产绑定配置，
不访问远端资源，不部署，也不自动清理数据库。

原始数据逐阶段写入 `results/<run-id>.json`。源码 HEAD、完整脏文件范围、
文件哈希、冻结的运行模块、迁移副本、环境、后台负载、SQL trace、
所有预热与正式样本、表行数和存储统计均保留。
运行模块及输入源码位于该轮持久化目录，生成的数据库被 Git 忽略。
`results/biome.json` 仅关闭生成 JSON 的格式重写，不放松源码检查。

## 数据与对照方法

- 初始数据为每库 50,000 条确定性的中文、英文混合知识记录，涵盖十类主题。
  两库保存相同原文、版本快照、已有标签、FTS rowid 映射、变更事件，保留向量同步触发器。
  最旧记录仍是咖啡习惯哨兵，所有记录处于同一个可见空间。
- 基线只写 trigram；另一库额外写 contentful 词索引。
  两个 FTS 索引使用相同的 `memories_fts_map.fts_rowid`。
  除下述显式人工路径夹具外，种子词文本直接由当前产品 `indexText` 生成。
- 本轮替换了原语料中的 101 条种子记录，构造人工缺词路径和不连续字符干扰。
  与历史轮次不再是逐字相同的种子语料，因此不能把大小或延迟差异全部归因于产品修改。
  配对写入阶段的记录范围、原文及 SQL 工作负载不变。
- 产品仍保留完整分词词项和去重汉字单字，不添加重叠 bigram，不做 NFKC。
  基准不修改产品输入上限、不截断原文，也不代替主控的 960 KB 边界测试。

## 三类查询与证据边界

| 测量项 | 查询 | 验证要求 |
| --- | --- | --- |
| 两字词 | `备份` | 返回有效结果，`partial=false` |
| 多词 | `项目 migration 发布` | 使用真实全文查询链路，`partial=false` |
| 人工路径选择夹具 | `云桥` | 故意缺失整词 token；仅验证人工条件下的 fallback SQL 路径 |

每类至少预热 5 次，随后测量 30 次，轮次间交替执行顺序。
均调用冻结的真实 `runFtsChannel`，`candidateK=50`，没有额外过滤器。
预热样本保留，但不进入 nearest-rank p50/p95。

### 人工路径选择夹具（历史字段名 cross_icu_fallback）

项目代号「云桥」出现在第 101 号旧记录的原始正文中。
只有这一条记录的种子词流去掉独立的 `云桥` token，保留产品生成的 `云`、`桥`
及其余词项；不修改原文或 trigram，不伪造/修改产品 tokenizer，也不改变索引结构。
这是故意构造的不完整目标词索引，不是自然产生的 ICU 索引。不得据此证明原生上下文词边界行为；此处不模拟或证明任何具体 ICU 版本。

另有 100 条短干扰记录，在标题重复独立的「云」「桥」，各原始字段均没有连续的「云桥」。
它们的标题权重和较短文档使未经原文验证的单字 BM25 候选优先。
正式采样前，在计时范围外执行以下断言并保存证据：

1. 当前查询 tokenizer 得到一个二字词 `云桥`，整个词索引中该整词的命中数为零。
2. 单字 AND 命中超过 50 条，未经连续性验证的前 50 条不包含目标。
3. 目标有超过 500 条更新记录，不能靠最新记录扫描侥幸命中。
4. 每个预热/正式 fallback 样本都执行两条 SQL：第一条返回零行，第二条仅返回目标。
   第二条 SQL 的原文字段连续性验证必须在外层 LIMIT 前，目标必须排名第一且 `partial=false`。

原始 JSON 保存粗候选前 50、目标 ID、更新记录数、每条 SQL 的返回行数和完整 SQL。
因此正式运行若没有真正走 fallback，或在 LIMIT 后才验证连续原文，会明确失败，
不会把快路径性能冒充 fallback 性能。准备阶段先通过纯函数和产品 tokenizer 的 Bun 单测；本轮随后通过真实 SQL
排序和人工路径召回断言。这仍不构成自然上下文分词行为的证据。

原有咖啡哨兵继续验证 `早上`、`他早上喝什么`、`黑咖啡` 在 49,999 条更新记录外排名第一，
并保留旧版最新 500 条扫描漏掉该记录的对照。

## 配对写入与耗时口径

两库每轮写入完全相同的 20 条新记录，交替先后顺序；各保留 5 个预热批次和
30 个正式批次。共同的 memory/version/tag/map/trigram/change SQL 相同，
词索引侧额外调用真实 `wordIndexStatements`，包括 Intl 分词和带 guard 的删除/插入。
现有标签 token 在准备阶段生成，原文生成与内容哈希不计入写入耗时。

分别报告 statement 准备、`db.batch` 墙钟、D1 返回 `meta.duration` 总和以及准备加批次总耗时。
准备耗时包含 Miniflare 的 `prepare`/`bind` 主机代理 IPC，不能视为纯分词 CPU 成本。
查询墙钟同样包含 Bun 分词、代理传输和结果映射；D1 时间为所有实际 SQL 的耗时之和，
其毫秒量化可能使极短语句显示零。两组完整配对样本和每轮差值全部保留，不能删异常值。

这不是完整 MemoryRepo/API、HTTP 鉴权、更新/删除、新标签创建、backfill 或向量/hybrid 吞吐测量。

## 索引大小与机器负载

查询在 50,000 条数据上测量；写入后每库是 50,700 条。
两阶段分别保留全部应用表和 FTS shadow table 行数，检查词索引 rowid 映射没有孤儿。
D1 `meta.size_after` 记录已用数据库大小；FTS payload 记录 data/docsize/term/content 字节，
不含 B-tree 页开销。释放 Miniflare 后，只读本轮已标记的 SQLite，使用 `dbstat` 获取
逐表分配字节，并分别记录主文件、WAL、页数及空闲页。它们不等于 Cloudflare 计费大小。
不执行 FTS optimize 或 VACUUM。

各阶段记录 CPU/内存、load average 与高 CPU 进程。主控让出重型验证窗口并不意味着
操作系统、Defender 或其他应用空闲，不能据此承诺生产 SLA，也不能直接把历史轮次的
墙钟差异解释为源码优化效果。

## 历史正式结果：全部 superseded

以下两个 50k JSON 留在仓库内，完整样本和源码摘要不变，仅调整上述哈希清单编码；改动前字节另有归档。它们都不包含当前 fallback 的
测量，不是新源码的最终结果。只在这里汇总一次，完整指标以各自原始 JSON 为准。

| 历史运行 | `备份` 墙钟 p50/p95 ms | 多词墙钟 p50/p95 ms | 50k 基线/词索引库 MiB | 失效原因 |
| --- | --- | --- | --- | --- |
| [13:51 轮次](results/2026-10-18T13-51-30-681Z-REiIBH.json) | 122.46 / 259.60 | 129.38 / 197.75 | 142.46 / 224.05 | 已移除当时的 bigram extras 与 NFKC；也没有短复合词 fallback |
| [14:11 轮次](results/2026-10-18T14-11-25-199Z-ldo8ND.json) | 195.66 / 265.39 | 218.16 / 319.25 | 142.46 / 203.14 | 索引已修正，但没有当前短复合词 fallback 的源码及采样 |

两轮基于带工作区修改的 HEAD `d6306840c551096abb7b32d994f3b878f3807dcf`，
不能仅凭相同 HEAD 就视为相同源码。各自的冻结模块和文件哈希以原始 JSON 为准。
状态清单保留完整 supersession 信息，不改写原始测量文件的完成状态。

## 失败与冒烟归档

仅四份失败/1k 冒烟原始 JSON 移到仓库外：
`/Users/nocoo/workspace/personal/.octo-ctl/r3-benchmark-archive/`。
移动前后核对 SHA-256；归档文件名、状态、原行数、绝对路径及哈希记录在
`results/word-search-status.json` 的 `archived_failed_and_smoke_runs`。
没有移动任何 50k 历史正式 JSON，也没有删除任何本地数据库或冻结源码。

早期夹具调查发现：安装的 workerd 不接受过新的 compatibility date，因此使用项目现有
`2026-04-01`；D1 不允许读取保留表 `_cf_METADATA` 和页数 PRAGMA，也没有 `dbstat`。
所以运行中读取 D1 大小 metadata，逐页统计放到运行时释放后的本地只读检查，
不修改产品配置来迁就基准。

## 窄范围验证

以下命令不运行产品完整 suites、L2/L3、覆盖率或原生探针：

```sh
bun test benchmarks/word-search-lib.test.ts
bunx --no-install biome check --error-on-warnings benchmarks
bunx --no-install tsc --ignoreConfig --noEmit --target ES2022 --lib ES2022 \
  --module esnext --moduleResolution bundler --strict --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --skipLibCheck --types bun,@cloudflare/workers-types \
  benchmarks/word-search.ts benchmarks/word-search-lib.ts \
  benchmarks/word-search-runtime.ts benchmarks/word-search-lib.test.ts
```

新增夹具/helper 先红后绿；当前 7 个测试、337 个断言通过。排序比较器和计数器使用描述性参数，
没有新增单字母 TypeScript 变量。本轮正式测量、人工路径 D1 断言和运行时释放均已完成，结果集中记录在首节。
