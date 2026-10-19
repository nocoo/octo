import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFloat32Vector, l2Normalize } from "../../apps/web/src/server/search/math";
import { indexText } from "../../apps/web/src/server/search/tokenizer";
import { assertAsyncTestMarker } from "../../scripts/local-d1";
import { base, e2eD1, query, seedKey, sqlText } from "../fixtures/l2-batch";

const spaceId = "sp_search_ranking";
const profile = "te3-small-1536";
const memories = [
	{
		id: "coffee",
		title: "Drink preference / 饮品偏好",
		body: "Every morning he drinks black coffee. 他每天早上喝黑咖啡。",
	},
	{
		id: "rotation",
		title: "Key rotation / 轮换策略",
		body: "Production keys are rotated every 90 days. 密钥每 90 天轮换一次。",
	},
	{
		id: "dashboard",
		title: "What does the dashboard show?",
		body: "In the overview he sees service health and recent activity. 仪表盘展示服务健康状态。",
	},
	{
		id: "meetings",
		title: "How often are team meetings held?",
		body: "The team meets weekly in the office. 团队每周开一次例会。",
	},
	{
		id: "backup",
		title: "How often are backups verified?",
		body: "Backups are verified daily in the staging environment. 每天验证备份可用性。",
	},
	{
		id: "releases",
		title: "How often are releases published?",
		body: "Releases are published every Friday after checks pass. 每周五发布版本。",
	},
	{
		id: "breakfast",
		title: "What does he eat for breakfast?",
		body: "In the kitchen he prepares oatmeal and fruit. 他早餐吃燕麦和水果。",
	},
	{
		id: "tea",
		title: "Evening tea / 晚上喝什么",
		body: "In the evening he drinks green tea after dinner. 他晚上喝绿茶。",
	},
	{
		id: "exercise",
		title: "Morning exercise / 早上运动",
		body: "In the park he walks before work. 他每天早上散步半小时。",
	},
	{
		id: "commute",
		title: "What does he use for commuting?",
		body: "In the city he travels by train. 他乘地铁上班。",
	},
	{
		id: "reading",
		title: "What does he read?",
		body: "In the library he reads history books. 他喜欢阅读历史书。",
	},
	{
		id: "standup",
		title: "Daily standup / 早上例会",
		body: "The morning standup starts at nine. 早上九点举行站会。",
	},
	{
		id: "key-storage",
		title: "Where are keys stored?",
		body: "Service keys belong in the secret manager, never in logs. 密钥保存在秘密管理器中。",
	},
	{
		id: "encryption",
		title: "Data encryption / 数据加密",
		body: "The storage service encrypts data at rest. 静态数据必须加密。",
	},
	{
		id: "permissions",
		title: "What are the access rules?",
		body: "Default deny keeps private spaces invisible. 默认拒绝未授权的空间访问。",
	},
	{
		id: "logs",
		title: "How are logs retained?",
		body: "The audit log is retained indefinitely without request bodies. 永久保留不含正文的审计记录。",
	},
	{
		id: "monitoring",
		title: "Service monitoring / 服务监控",
		body: "The health endpoint is checked every minute. 每分钟检查服务健康状态。",
	},
	{
		id: "vacation",
		title: "When does he take vacation?",
		body: "In the summer he prefers a quiet mountain trip. 他夏天喜欢去山里度假。",
	},
	{
		id: "newsletter",
		title: "How often is the newsletter sent?",
		body: "The newsletter arrives monthly. 每月发送一次简报。",
	},
	{
		id: "shell",
		title: "Shell preference / 终端偏好",
		body: "He uses zsh with a small set of aliases. 他在终端使用 zsh。",
	},
	{
		id: "noncontiguous-coffee",
		title: "Unrelated words / 不连续的词",
		body: "A blacklist and a cafe. 黑名单和咖啡并列，不构成词组。",
	},
	{
		id: "quoted-question",
		title: "Literal quotation / 字面引用",
		body: "什么 多久。",
	},
];
const memoryId = (id: string) => `mem_ranking_${id}`;
const reservedMemoryId = memoryId("reserved-trash");
const idsSql = [...memories.map(({ id }) => memoryId(id)), reservedMemoryId].map(sqlText).join(",");
const fakeVector = (axis: number) =>
	Array.from({ length: 1536 }, (_, index) => (index === axis ? 1 : 0));
let key: { id: string; token: string } | undefined;

async function cleanup() {
	const d1 = await e2eD1();
	await assertAsyncTestMarker(d1);
	await d1([
		"--command",
		`DELETE FROM memories_fts WHERE rowid IN (SELECT fts_rowid FROM memories_fts_map WHERE memory_id IN (${idsSql}));
DELETE FROM memories_words_fts WHERE rowid IN (SELECT fts_rowid FROM memories_fts_map WHERE memory_id IN (${idsSql}));
DELETE FROM memory_vectors WHERE memory_id IN (${idsSql});
DELETE FROM memories_fts_map WHERE memory_id IN (${idsSql});
DELETE FROM memories WHERE id IN (${idsSql});
DELETE FROM vector_sync_jobs WHERE memory_id IN (${idsSql});
DELETE FROM spaces WHERE id = ${sqlText(spaceId)};
${key ? `DELETE FROM api_keys WHERE id = ${sqlText(key.id)};` : ""}`,
	]);
}

beforeAll(async () => {
	await cleanup();
	const d1 = await e2eD1();
	await assertAsyncTestMarker(d1);
	key = await seedKey(d1, { ops: "r", scope: "spaces", spaceIds: [spaceId] });
	const commands = [
		`INSERT INTO spaces (id,slug,name,created_at,updated_at) VALUES (${sqlText(spaceId)},'search-ranking','Search ranking',1,1);`,
		`INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at,deleted_at)
VALUES (${sqlText(reservedMemoryId)},${sqlText(spaceId)},'Reserved trash','','note',${sqlText(key.id)},'reserved-hash',1,1,1);
INSERT INTO memories_fts_map(memory_id,fts_rowid) SELECT ${sqlText(reservedMemoryId)},
max(COALESCE((SELECT MAX(fts_rowid) FROM memories_fts_map),0),COALESCE((SELECT MAX(rowid) FROM memories_fts),0))+1;`,
	];
	for (const [index, memory] of memories.entries()) {
		const id = sqlText(memoryId(memory.id));
		const title = sqlText(memory.title);
		const body = sqlText(memory.body);
		const blob = Buffer.from(encodeFloat32Vector(l2Normalize(fakeVector(index)))).toString("hex");
		commands.push(`INSERT INTO memories (id,space_id,title,body,type,source_key_id,content_hash,created_at,updated_at)
VALUES (${id},${sqlText(spaceId)},${title},${body},'note',${sqlText(key.id)},'ranking-hash',${index + 1},${index + 1});
INSERT INTO memories_fts_map(memory_id,fts_rowid) SELECT ${id},COALESCE(MAX(fts_rowid),0)+1 FROM memories_fts_map;
INSERT INTO memories_fts(rowid,title,body,tags) SELECT fts_rowid,${title},${body},'' FROM memories_fts_map WHERE memory_id=${id};
INSERT INTO memories_words_fts(rowid,title,body,tags) SELECT fts_rowid,${sqlText(indexText(memory.title))},${sqlText(indexText(memory.body))},'' FROM memories_fts_map WHERE memory_id=${id};
INSERT INTO memory_vectors (memory_id,profile_id,embedding_model,dim,vector,content_hash,updated_at)
VALUES (${id},${sqlText(profile)},'text-embedding-3-small',1536,X'${blob}','ranking-hash',1);`);
	}
	await d1(["--command", commands.join("\n")]);
});

afterAll(cleanup);

it("preserves the unindexed trashed mapping while allocating live search fixtures", async () => {
	expect(
		await query(
			await e2eD1(),
			`SELECT m.deleted_at IS NOT NULL AS trashed,
(SELECT COUNT(*) FROM memories_fts WHERE rowid=map.fts_rowid) AS indexed
FROM memories m JOIN memories_fts_map map ON map.memory_id=m.id WHERE m.id=${sqlText(reservedMemoryId)}`,
		),
	).toEqual([{ trashed: 1, indexed: 0 }]);
});

type SearchBody = {
	items: Array<{ id: string; scores: { fts: { rank: number } | null } }>;
	channels: { fts: { candidates: number; partial: boolean }; vector: { candidates: number } };
};

async function search(query: string, mode: string, axis: number) {
	const response = await fetch(`${base}/api/v1/search`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key?.token}` },
		body: JSON.stringify({ query, mode, vector: { profile, values: fakeVector(axis) }, limit: 5 }),
	});
	expect(response.status).toBe(200);
	return (await response.json()) as SearchBody;
}

describe.each(["fts", "hybrid"])("representative search ranking in %s mode", (mode) => {
	it.each([
		{ query: "what does he drink in the morning", target: "coffee", axis: 0 },
		{ query: "how often are keys rotated", target: "rotation", axis: 1 },
		{ query: "早上 喝 什么", target: "coffee", axis: 0 },
		{ query: "密钥 多久 轮换", target: "rotation", axis: 1 },
		{ query: "他早上喝什么", target: "coffee", axis: 0 },
		{ query: "密钥多久轮换一次", target: "rotation", axis: 1 },
		{ query: "黑咖啡", target: "coffee", axis: 0 },
		{ query: "每天早上喝黑咖啡", target: "coffee", axis: 0 },
		{ query: "早上 喝", target: "coffee", axis: 0 },
		{ query: "什么 多久", target: "quoted-question", axis: 21 },
	])("ranks the answer first for $query", async ({ query, target, axis }) => {
		const result = await search(query, mode, axis);
		expect(result.items[0]?.id).toBe(memoryId(target));
		expect(result.items[0]?.scores.fts?.rank).toBe(1);
		expect(result.channels.fts.candidates).toBeGreaterThan(0);
		if (mode === "hybrid") expect(result.channels.vector.candidates).toBe(memories.length);
		if (query === "what does he drink in the morning") {
			expect(result.channels.fts.candidates).toBe(1);
		}
	});
});

it("keeps an all-English-stopword query searchable rather than returning every memory", async () => {
	const result = await search("what does he", "fts", 0);
	expect(result.items.length).toBeGreaterThan(0);
	expect(result.channels.fts.candidates).toBeLessThan(memories.length);
});
