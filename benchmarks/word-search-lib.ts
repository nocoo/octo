export function percentile(values: number[], fraction: number): number {
	if (!values.length || fraction <= 0 || fraction > 1) throw new Error("invalid percentile input");
	const ordered = [...values].sort((leftValue, rightValue) => leftValue - rightValue);
	return ordered[Math.ceil(ordered.length * fraction) - 1] as number;
}

export function summarize(values: number[]) {
	return {
		count: values.length,
		min: Math.min(...values),
		p50: percentile(values, 0.5),
		p95: percentile(values, 0.95),
		max: Math.max(...values),
		mean: values.reduce((sum, value) => sum + value, 0) / values.length,
	};
}

export const TOPICS = [
	[
		"数据库备份",
		"database",
		"每周检查数据库备份，在隔离环境执行恢复演练，记录对象存储路径和保留期限。D1 snapshot recovery verifies checksum and retention policy.",
	],
	[
		"项目发布",
		"release",
		"项目采用分阶段 migration 发布流程，先验证数据再开放服务。Release owners review schema changes, deployment artifacts and rollback procedures.",
	],
	[
		"接口设计",
		"api",
		"接口采用游标分页，明确权限边界及幂等请求行为。API clients send request identifiers and retry transient failures with exponential backoff.",
	],
	[
		"搜索质量",
		"search",
		"搜索评估包含中文问句、英文缩写和混合文本，保存相关性标注。Search relevance uses ranked keyword candidates and vector retrieval evaluation.",
	],
	[
		"安全审计",
		"security",
		"密钥定期轮换，审计日志只记录必要的元数据，禁止保存访问凭据。Security review checks scoped access, credential rotation and audit integrity.",
	],
	[
		"性能分析",
		"performance",
		"性能报告区分吞吐与尾延迟，分析缓存命中率及队列积压。Latency profiling records p50 and p95 alongside CPU utilization and memory allocation.",
	],
	[
		"客户访谈",
		"research",
		"客户希望整理团队知识，快速找到决策背景，减少重复沟通。Research interviews capture workflows, product feedback and onboarding friction.",
	],
	[
		"团队协作",
		"team",
		"周会安排在周三下午，讨论本周交付和未解决问题，并指定负责人。Weekly planning covers engineering milestones, dependencies and action items.",
	],
	[
		"旅行笔记",
		"travel",
		"出差前确认酒店与车票，把行程存进个人笔记，保留可离线查看的地图。Travel notes collect train schedules, hotel details and expense receipts.",
	],
	[
		"阅读摘录",
		"reading",
		"阅读笔记记录核心论点、引用来源和待验证的假设，定期回顾。Reading summaries connect distributed systems, documentation and design tradeoffs.",
	],
] as const;

export const CROSS_ICU = { query: "云桥", targetIndex: 101, distractorCount: 100 } as const;

export function corpusRow(index: number) {
	const topic = TOPICS[index % TOPICS.length] as (typeof TOPICS)[number];
	const project = ["Orion", "Maple", "Cedar", "Harbor", "Atlas"][Math.floor(index / 10) % 5];
	const detail = [
		"验收需要记录实际结果，不根据预期推断成功。Acceptance includes reproducible evidence.",
		"本轮改动范围保持最小，后续工作单独追踪。Follow-up work has an explicit owner.",
		"不同环境使用独立配置，测试数据不进入正式系统。Local fixtures remain isolated.",
		"操作步骤经过同事复核，相关链接附在任务记录中。Peer review verifies assumptions.",
	][Math.floor(index / 50) % 4];
	const record = {
		id: `bench-${String(index).padStart(7, "0")}`,
		rowid: index + 1,
		title: index === 0 ? "个人饮食习惯" : `${topic[0]} / ${project} memo ${index}`,
		body:
			index === 0
				? "他早上只喝黑咖啡，不加糖。Personal routine: black coffee before the commute."
				: `${topic[2]} ${detail} 项目 ${project}，记录编号 ${index}，跟踪 issue-${index % 997}，负责人 team-${index % 31}。Revision ${1 + (index % 12)}; measured duration ${10 + (index % 173)} ms.`,
		tag_id: `tag-${index % TOPICS.length}`,
		tag: `${topic[0]} ${topic[1]}`,
		updated_at: 1_700_000_000_000 + index * 1_000,
	};
	if (index === CROSS_ICU.targetIndex) {
		record.title = "旧系统迁移档案 / legacy project record";
		record.body = `内部项目代号是${CROSS_ICU.query}。This archived migration decision records the project name, ownership, validation history and rollout constraints. ${record.body} ${detail}`;
	} else if (index >= 1 && index <= CROSS_ICU.distractorCount) {
		record.title = `云 桥 云 桥 / separate concepts ${index}`;
		record.body =
			"云资源与桥梁是独立概念，不是同一项目代号。Separate cloud and bridge references from infrastructure research.";
	}
	return record;
}

export type CorpusRow = ReturnType<typeof corpusRow>;
const crossIcuTargetId = corpusRow(CROSS_ICU.targetIndex).id;

export function seedWordFields(row: CorpusRow, indexText: (text: string) => string) {
	function indexField(text: string) {
		const tokens = indexText(text);
		if (row.id !== crossIcuTargetId || !text.includes(CROSS_ICU.query)) {
			return tokens;
		}
		const words = tokens.split(" ").filter((token) => token !== CROSS_ICU.query);
		if (![...CROSS_ICU.query].every((character) => words.includes(character))) {
			throw new Error("cross-ICU fixture requires production unigram tokens");
		}
		return words.join(" ");
	}
	return {
		word_title: indexField(row.title),
		word_body: indexField(row.body),
		word_tags: indexField(row.tag),
	};
}

export function assertCrossIcuSample(sample: {
	hits: number;
	first_id: string | null;
	partial: boolean;
	traces: Array<{ sql: string; result_rows: number }>;
}) {
	const direct = sample.traces[0];
	const fallback = sample.traces[1];
	const verificationOffset = fallback?.sql.indexOf("instr(m.title") ?? -1;
	const limitOffset = fallback?.sql.toUpperCase().lastIndexOf("LIMIT") ?? -1;
	if (
		sample.hits !== 1 ||
		sample.first_id !== crossIcuTargetId ||
		sample.partial ||
		sample.traces.length !== 2 ||
		direct?.result_rows !== 0 ||
		fallback?.result_rows !== 1 ||
		verificationOffset < 0 ||
		limitOffset <= verificationOffset
	)
		throw new Error(
			"cross-ICU fallback must verify original fields before LIMIT and recall only the target",
		);
}
export function sourceManifest(hashes: Record<string, string>) {
	return Object.entries(hashes).map(([path, sha256]) => ({ path, sha256 }));
}
