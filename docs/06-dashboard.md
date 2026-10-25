# 06 — Dashboard

> 返回 [文档目录](README.md)

Vite + React 19 SPA，由同一个 Worker 的 `[assets]` 托管，受 Cloudflare Access 保护，拥有全部权限。UI **只用 `@nocoo/basalt@3.1.0`**；壳和 MVVM 框架参考 giraffe 的 `apps/web/src/client`。目标是 2026 年一线水准的设计和动效。

## 1. Basalt 约束

- 装 npm 上发布的 `@nocoo/basalt@3.1.0`（精确版本）。禁止 vendoring、`file:` 依赖或拷贝源码。
- 动手前读安装包里的 `ai/USAGE.md`、`ai/INTEGRATION.md`、`ai/RECIPES.md`、`ai/DESIGN.md`、`ai/COMPATIBILITY.md`、`ai/registry.json`（120 个 catalog 条目）。声称「没有某个组件」之前必须查过 registry。
- 遵循 Basalt 的 MVP 顺序：Providers + CSS → 应用框架（`AppShell`、`Sidebar`、`AppHeader`、`ContentIsland`）→ `PageHeader` → `LayerCard` / `SectionRule`。因为 Access 负责登录，所以**没有应用内登录页**；身份信息（Access email）显示在 `SidebarUser`。
- 控件：Button / Input / Field / Dialog / Sheet / DropdownMenu / CommandPalette / SegmentControl / Switch / Checkbox / Badge / Table + TablePager / DataTable / DatePicker / StatStrip / Meter / DescriptionList / Toaster / ConfirmDialog，图表用 `@nocoo/basalt/charts/*`（需要 recharts peer）。禁止裸的 `input` / `button` / `select`。
- 只用 design token，不写死颜色和间距；字号不小于 11px；尽量压缩纵向空间。
- 设计审计和实现按 workflow 的 `system0-design-basalt` skill 执行（标准、审计、升级）。

## 2. 架构（MVVM）

- `src/client/lib/api.ts` 是唯一调用 `fetch` 的地方，只请求同源的 `/api/admin/*`；`gate:client-fetch` 用 AST 强制检查（照搬 giraffe）。
- `viewmodels/*` 是纯 TS，不 import React DOM 或 Basalt，由 L1 覆盖；`routes/*.tsx` 和 `components/layout/**` 是薄 View，不计入 L1 覆盖率，由 L3 覆盖。
- 状态：URL 是筛选和选择的唯一真相；服务端数据由 ViewModel 缓存，SWR 风格（先显示旧数据，后台重新校验）。
- 键盘：`⌘K` 打开 CommandPalette（跳转到 memory、页面或命令），`/` 聚焦搜索，`j/k` 上下移动，`e` 编辑，`⌘S` 保存。

## 3. 页面

| 路由 | 页面 | 要点 |
|---|---|---|
| `/` | 总览 | StatStrip（memory 数、今日写入、活跃 agent、待同步向量、回收站数量）；agent 活动热力图；最近变更流 |
| `/memories` | 记忆库 | 左侧筛选（space、标签、类型、来源、时间、重要度），右侧列表 / 卡片切换；批量选择 → 打标签 / 移动 / 删除 |
| `/memories/:id` | 阅读 | 一流的 Markdown 阅读体验：GFM 表格、代码高亮、图片（附件经过鉴权代理）、自动 TOC（sticky，移动端折叠）、阅读宽度约 72ch；右栏显示元数据、标签、版本时间线 |
| `/memories/:id/edit` | 编辑 | 分栏 Markdown 编辑 + 实时预览（移动端用 tab 切换）；粘贴或拖入图片 / PDF 直接上传附件；保存时带 `If-Match`，冲突时打开三方对比 |
| `/memories/:id/history` | 版本 | 版本列表 + 左右或行内 diff（字段级 + 正文）；选中任意版本 → 回滚（ConfirmDialog） |
| `/search` | 搜索 | 与 API 功能对等：模式（hybrid / fts / vector）、融合方法和参数、过滤条件；每个结果展示各通道分数条（fts / vector / fused）。查询文本由 Worker 经 `QueryEmbedder` 转成向量（「向量模型」设置页配置的网关）；未配置时降级为全文 + 过滤，见 03 §2.1 |
| `/tags` | 标签 | 用量表、重命名、合并（预览受影响条目数）；标签共现图 |
| `/spaces` | 空间 | 列表、新建、重命名、所属密钥、记忆计数 |
| `/graph` | 关系图 | 沉浸式整屏画布：标签 ↔ memory 二部图 / 标签共现图（力导向 canvas；节点数上限 + 聚类），左浮动节点列表、右浮动详情、顶部工具栏、数据表在 Sheet 中，见 §7 |
| `/timeline` | 时间线 | 按 `event_time` / `created_at` 排布的事件时间线，可缩放 |
| `/keys` | API Key | 按角色模板创建；明文只显示一次（可复制，关闭后不可再看）；轮换（宽限期）、吊销、过期；每个 key 的用量 sparkline |
| `/usage` | 用量与健康 | 按 key / 日的调用数、错误率、延迟 P50 / P95；D1 体积、向量同步积压、cron 最近运行时间 |
| `/audit` | 审计 | 按 actor、路由、状态码、时间筛选；大表虚拟滚动；导出 CSV |
| `/trash` | 回收站 | 分页选择、全部匹配项选择、批量恢复/彻底删除；按当前筛选清空并危险确认数量；单条永久删除保留标题核验 |
| `/settings` | 设置 | embedding profile、版本信息 |
| `/settings/embedding` | 向量模型 | base URL、API key（只能写，显示「已设置 ••••abcd」，可以替换或清除）、model（默认 text-embedding-3-small）、dims（默认 1536）、「测试连接」按钮、服务端补向量开关（默认关）；只通过 Access 保护的 admin API 访问 |

空间页每行的「重命名」打开 Basalt 紧凑弹窗。修改「空间名称」并点击「保存名称」，通过现有 `PATCH /api/admin/spaces/:slug` 只提交名称；空间标识、说明、所属密钥和记忆均不变。名称复用共享 schema，去除首尾空白后为 1 至 256 个字符。客户端和服务端校验均按问题路径把中文提示关联到对应字段；请求故障保留在弹窗内，可修改重试或取消。保存成功后刷新列表，重新加载页面仍显示新名称。

## 4. 可视化

回收站使用独立 `TrashModel` / `TrashPage`，复用统一 admin API client。标题/标签关键词和空间筛选在服务端执行，总数来自服务端；筛选和选择保存在 URL。表头勾选仅当前页，避免把一次点击解释为跨页破坏操作；选择后显式提供「选择全部 N 条」，完整枚举带签名游标的分页并冻结 ID 后才确认/执行。切换筛选会清空旧选择，过时的异步响应不能改写新范围。

「彻底删除所选」显示冻结的精确数量并使用危险确认；「清空回收站（N）」只清空当前关键词/空间范围，确认框同时展示范围和数量，通过原始 `expected_count` 和服务端游标分批推进。处理中禁用选择和操作，显示进度、实际删除数及逐项失败；失败不清除未完成选择，也不自动放宽范围重试。单行永久删除继续采用输入标题、再危险确认的两步流程。选择框、分页按钮、筛选器、提示和对话框均使用 Basalt 3.1.0，图标使用 lucide，应用标签为中文。

- 统一用 Basalt charts（recharts）和 `chart-theme` 风格的色板（参照 giraffe：类别到颜色的映射稳定，排序变化不换色）。
- 标签和关系图是 Basalt 没有覆盖的领域：用成熟库（例如 `react-force-graph` 或 `sigma.js` + graphology）放在 Basalt `LayerCard` 里，配色读 Basalt token。选库前先确认 Basalt 3.1.0 没有对应组件。
- agent 活动用 calendar heatmap + 按 key 堆叠的面积图。

## 5. 设计和动效（2026 标准）

- 动效遵循 Basalt `DESIGN.md` 的 motion 规则：时长 150–250ms，用标准 easing；尊重 `prefers-reduced-motion`。
- 用 View Transitions API 做列表到详情的共享元素过渡（不支持时降级为淡入）。
- 骨架屏只用在首屏加载超过 200ms 时；操作后乐观更新 + toast，提供撤销（删除可以从回收站撤销）。
- 深色 / 浅色主题（Basalt ThemeProvider），accent 用 octo 品牌色（logo 按 `zhengli-project-logo` skill 另外生成）。
- 移动端：侧栏变成 Sheet，阅读页单栏，TOC 改成浮动按钮。
- 可访问性：跳过链接（`AppMain tabIndex={-1}`）、焦点环、对比度 AA、所有图表都有表格备选视图。

## 6. 测试

### Dashboard v2 presentation

The installed Basalt 3.1.0 `TagBadge` owns the six-color, deterministic FNV-1a
label palette and its light/dark foreground pairs. Tags, spaces and key scopes
use label-based assignment; key lifecycle states use explicit semantic colors.
The application tests repeatability, order independence and palette distribution.

The logo's blue artwork includes a prominent RGB `(64, 144, 224)` cluster.
`AccentProvider` overrides the supported `sky` swatch with the rounded
`210 72% 56%` light value and a `210 72% 68%` dark value, preserving the hue
while adjusting dark-theme luminance. These are raw palette values; Basalt
derives the contrast-safe primary (`210 72% 41%` in light mode) and its foreground;
chart and status palettes remain independent. The original logo assets are unchanged.

Header actions retain the Basalt template gap and use the Giraffe reference's
32px-wide controls, 34px control height and 18px icons, expressed through existing
Basalt tokens. Coarse pointers retain the native 44px touch minimum. Tables retain
native cell-painted hover/selection states and
add token-colored headers, compact row separators and logical numeric/action
alignment. No replacement controls or surface system are introduced.

- L1：每个 ViewModel 的状态机、筛选和 URL 互相转换、diff 渲染模型、Markdown TOC 提取。
- L3（Playwright Chromium，本地隔离）：搜索 → 阅读 → 编辑 → 冲突 → 回滚；创建 key → 明文只出现一次 → 吊销；删除 → 回收站 → 恢复 → 硬删除；移动端视口的阅读页。

## 7. 关系图的沉浸式画布

关系图是整页铺满内容岛的单一画布，不再由卡片分节堆叠：

- 画布是 `LayerCard`（Basalt surface）内的 canvas，`resize` 由 ResizeObserver 驱动；主题切换时重新读取 token 重绘，`prefers-reduced-motion` 下关闭拖拽、动效与长时间布局计算。
- 节点绘制使用 canvas 2D：标签为大节点（半径随度数增长，绿色 `--basalt-chart-green`），记忆为小点（蓝色 `--basalt-chart-blue`），聚合节点为灰色；名称只绘制度高标签、选中与悬停节点，随缩放保持 11px 屏幕字号。选中节点时其余节点与关联线降到低透明度，形成焦点。
- 顶部居中 `Toolbar`：放大、缩小、适应画布、显示节点名称、暂停／继续布局计算、节点列表、图谱数据表。适应画布在布局结算后自动执行一次，用户手动缩放或拖动后不再强制覆盖。
- 左侧浮动 `LayerCard`：节点搜索（`find`）、类型过滤（`kind`）、按度数排序的节点列表；点击即选中。右侧浮动 `LayerCard`：所选节点属性（`DescriptionList`）、跳转动作、关联节点列表；关闭即清除选择。
- 选择与过滤保留在 URL（`node`、`find`、`kind`、`mode`、`space`、`cap`）；`node` 与 `find` 用 `replace` 写入，避免污染历史。`Esc` 不参与画布操作。
- 小于 1024px 时两个浮动面板隐藏，改由工具栏打开 Sheet：`节点列表` 与 `节点详情`；选择节点后自动打开详情 Sheet。
- 图谱数据表（节点表 + 关系表）从页面正文移入 `图谱数据表` Sheet，保持「图表都有表格备选」的可访问性契约，页面上不再出现表格。

## 8. 单行页头与纵向空间

Basalt `PageHeader` 的 `description` 与 `filters` 槽位会各占一行，本项目的 `components/layout/page-header.tsx` 因此覆盖它（与 zhe 的 `components/ui/page-header.tsx` 同一契约）：

```ts
{ title: ReactNode; meta?: ReactNode; actions?: ReactNode }
```

- 每页只有一行 chrome：返回键 + `h1` + 内联 meta（计数、范围、一句话说明，溢出截断并用 `title` 保留全文）+ 右侧 actions。
- `h1` 用 `flex: 0 0 auto` 只占文本宽度（长标题在 100% 处折行并限两行），meta 在同一行紧随其后，不允许被标题盒撑开距离。
- 筛选、视图切换与主操作都在 `actions` 里，全部使用 Basalt 原生默认密度（34px）：`Button`/`Input`/`SelectTrigger` 不传 `size="sm"`，`ToggleGroup` 也保持默认。**同一行不允许混用 28px 与 34px**——`ViewSwitch` 没有 compact 变体，所以整行统一到 34px。主操作永远最后一个；窄屏整行折到标题下方。
- 记忆库的分页行同样统一 34px；`MultiSelect` 外层 `space-y` 会给按钮加 8px 下边距（它后面还有一个 sr-only 计数元素），`octo-filter-choice` 的两条规则只为消除这个额外高度，让筛选行与按钮基线一致。
- 工具栏里的字段不再用 `Field` 包一层标签行，改用控件自身的 `aria-label` 与 `title`。
- 只为标注单张表格而存在的 `SectionRule` 标题带已删除：表格的 `aria-label` 就是它的名字。页面有 ≥2 个内容区块时才保留 `SectionRule`，并优先 `variant="label"`（单行细标），`variant="heading"` 只留给真正的区块入口。
- 表单项多的筛选（用量、审计、搜索）收进 `Popover`，页头只留一个「筛选（N）」按钮；`FilterBar` 的字段、chips 与「清除」都在弹层内，不占页面行。
- 记忆库保留一行紧凑筛选工具条（空间、类型、更多筛选、应用筛选），因为它是页面的主操作面。

1440×900 的基线（内容岛 832px，首个 surface 距岛顶）：总览/标签/空间/密钥/回收站 82px，每日用量 87px，审计 58px，关系图 82px，时间线 123px，记忆库 168px；改造前分别是 106/156/156/181/230、224、224、238、271、242px。关系图舞台因此从 570px 提升到 726px（内容岛的 87%）。
