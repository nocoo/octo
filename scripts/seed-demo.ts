import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { runIfMain } from "./cli";
import { valueHasRemoteTrue } from "./gate-no-remote";
import { DEV_WORKER_PORT } from "./ports";
import type { DemoMemory, DemoSpace } from "./seed-demo-data";

const localOrigin = `http://127.0.0.1:${DEV_WORKER_PORT}`;

type MemoryIdentity = { space: string; title: string };
type MemoryPage = { items: MemoryIdentity[]; next_cursor: string | null };
type SeedRequest = <Result>(path: string, init?: RequestInit) => Promise<Result>;
export type SeedFetch = (url: string, init: RequestInit) => Promise<Response>;

export function assertLocalSeedConfig(toml: string): void {
	const config = parse(toml);
	const databases = config.d1_databases;
	const buckets = config.r2_buckets;
	if (
		config.name !== "octo" ||
		valueHasRemoteTrue(config) ||
		"routes" in config ||
		"vectorize" in config ||
		!Array.isArray(databases) ||
		databases.length !== 1 ||
		(databases[0] as Record<string, unknown>).binding !== "DB" ||
		(databases[0] as Record<string, unknown>).database_name !== "octo-db" ||
		!Array.isArray(buckets) ||
		buckets.length !== 1 ||
		(buckets[0] as Record<string, unknown>).binding !== "FILES" ||
		(buckets[0] as Record<string, unknown>).bucket_name !== "octo-files"
	) {
		throw new Error("Unsafe demo seed config; start the daily local development server first");
	}
}

function memoryIdentity(memory: MemoryIdentity): string {
	return JSON.stringify([memory.space, memory.title]);
}

async function existingMemories(request: SeedRequest, spaces: DemoSpace[]) {
	const query = new URLSearchParams({
		limit: "200",
		spaces: spaces.map((space) => space.slug).join(","),
		include: "trashed",
	});
	const identities = new Set<string>();
	const cursors = new Set<string>();
	for (;;) {
		const page = await request<MemoryPage>(`/api/admin/memories?${query}`);
		for (const item of page.items) identities.add(memoryIdentity(item));
		if (!page.next_cursor) return identities;
		if (cursors.has(page.next_cursor)) throw new Error("Repeated seed cursor");
		cursors.add(page.next_cursor);
		query.set("cursor", page.next_cursor);
	}
}

export async function seedDemo(
	spaces: DemoSpace[],
	memories: DemoMemory[],
	fetcher: SeedFetch = fetch,
) {
	const request: SeedRequest = async (path, init = {}) => {
		const response = await fetcher(`${localOrigin}${path}`, {
			...init,
			headers: { Origin: "https://octo.dev.hexly.ai", ...init.headers },
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) {
			throw new Error(`Seed request failed: ${init.method ?? "GET"} ${path} (${response.status})`);
		}
		return response.json();
	};
	const health = await request<{
		status: string;
		name: string;
		database: { connected: boolean };
		d1_marker: string | null;
	}>("/api/live");
	if (
		health.status !== "ok" ||
		health.name !== "octo" ||
		health.database.connected !== true ||
		health.d1_marker !== null
	)
		throw new Error("Seed requires the healthy daily local development database, not a test lane");
	const settings = await request<{ backfill_enabled: boolean }>("/api/admin/settings/embedding");
	if (settings.backfill_enabled !== false) {
		throw new Error(
			"Disable embedding backfill locally before seeding; no external calls are allowed",
		);
	}
	const existingSpaces = (await request<{ items: DemoSpace[] }>("/api/admin/spaces")).items;
	for (const space of spaces) {
		const existing = existingSpaces.find((item) => item.slug === space.slug);
		if (existing && existing.description !== space.description) {
			throw new Error(`Space slug already in use: ${space.slug}`);
		}
	}
	const existing = await existingMemories(request, spaces);
	const report = {
		spacesCreated: 0,
		created: 0,
		skipped: 0,
		revised: 0,
		attachments: 0,
		trashed: 0,
	};
	const json = (method: string, body: unknown): RequestInit => ({
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	for (const space of spaces) {
		if (existingSpaces.some((item) => item.slug === space.slug)) continue;
		await request("/api/admin/spaces", json("POST", space));
		report.spacesCreated++;
	}
	for (const memory of memories) {
		const identity = memoryIdentity(memory.create);
		if (existing.has(identity)) {
			report.skipped++;
			continue;
		}
		const created = await request<{ id: string; version: number }>(
			"/api/admin/memories",
			json("POST", memory.create),
		);
		report.created++;
		existing.add(identity);
		const path = `/api/admin/memories/${encodeURIComponent(created.id)}`;
		if (memory.revision) {
			await request(path, json("PATCH", { ...memory.revision, expected_version: created.version }));
			report.revised++;
		}
		if (memory.attachment) {
			const attachment = memory.attachment;
			const form = new FormData();
			form.append("file", new Blob([attachment.body], { type: attachment.type }), attachment.name);
			await request(`${path}/attachments`, { method: "POST", body: form });
			report.attachments++;
		}
		if (memory.trash) {
			await request(path, { method: "DELETE" });
			report.trashed++;
		}
	}
	return report;
}

export async function main(
	run: () => Promise<unknown> = async () => {
		const { demoSpaces, demoMemories } = await import("./seed-demo-data");
		return seedDemo(demoSpaces, demoMemories);
	},
	loadConfig = () =>
		readFileSync(fileURLToPath(new URL("../.wrangler.local.toml", import.meta.url)), "utf8"),
): Promise<number> {
	assertLocalSeedConfig(loadConfig());
	console.log(`本地演示数据导入完成：${JSON.stringify(await run())}`);
	return 0;
}

await runIfMain(import.meta, main);
