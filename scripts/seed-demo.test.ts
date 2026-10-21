import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assertLocalSeedConfig, main, type SeedFetch, seedDemo } from "./seed-demo";
import type { DemoMemory, DemoSpace } from "./seed-demo-data";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));

const config = `name = "octo"
[[d1_databases]]
binding = "DB"
database_name = "octo-db"
[[r2_buckets]]
binding = "FILES"
bucket_name = "octo-files"
`;
const spaces: DemoSpace[] = [{ slug: "demo-test", name: "Demo", description: "Synthetic demo" }];
const memories: DemoMemory[] = [
	{
		key: "history",
		create: { space: "demo-test", title: "History", body: "Before", type: "note", tags: [] },
		revision: { body: "After" },
		attachment: { name: "diagram.svg", type: "image/svg+xml", body: "<svg/>" },
	},
	{
		key: "trash",
		create: { space: "demo-test", title: "Trash", body: "Discarded", type: "log", tags: [] },
		trash: true,
	},
];

function transport(overrides: Record<string, unknown> = {}) {
	const calls: Request[] = [];
	const defaults: Record<string, unknown> = {
		"GET /api/live": { status: "ok", name: "octo", database: { connected: true }, d1_marker: null },
		"GET /api/admin/settings/embedding": { backfill_enabled: false },
		"GET /api/admin/spaces": { items: [] },
		"GET /api/admin/memories": { items: [], next_cursor: null },
		"GET /api/admin/trash": new Response("Unsupported spaces filter", { status: 400 }),
	};
	const fetcher = vi.fn<SeedFetch>(async (input, init) => {
		const request = new Request(input, init);
		calls.push(request);
		const url = new URL(request.url);
		const route = `${request.method} ${url.pathname}`;
		const result = overrides[`${route}${url.search}`] ?? overrides[route] ?? defaults[route];
		if (result instanceof Response) return result;
		if (result !== undefined) return Response.json(result);
		if (route === "POST /api/admin/memories") {
			const payload = (await request.clone().json()) as { title: string };
			return Response.json({ id: payload.title.toLowerCase(), version: 1 }, { status: 201 });
		}
		return Response.json({ ok: true });
	});
	return { fetcher, calls };
}

describe("local demo seed", () => {
	it("creates spaces, memories, history, attachments and trash through the local API", async () => {
		const { fetcher, calls } = transport();
		expect(await seedDemo(spaces, memories, fetcher)).toEqual({
			spacesCreated: 1,
			created: 2,
			skipped: 0,
			revised: 1,
			attachments: 1,
			trashed: 1,
		});
		for (const request of calls) {
			expect(new URL(request.url).origin).toBe("http://127.0.0.1:37059");
			expect(request.redirect).toBe("error");
			expect(request.headers.get("Origin")).toBe("https://octo.dev.hexly.ai");
			expect(request.signal).toBeDefined();
		}
		expect(
			calls.some((request) => new URL(request.url).searchParams.get("include") === "trashed"),
		).toBe(true);
		const patch = calls.find((request) => request.method === "PATCH");
		expect(await patch?.json()).toEqual({ body: "After", expected_version: 1 });
		const upload = calls.find((request) => request.url.endsWith("/attachments"));
		const file = (await upload?.formData())?.get("file") as File;
		expect(file.name).toBe("diagram.svg");
		expect(file.type).toBe("image/svg+xml");
		expect(await file.text()).toBe("<svg/>");
		expect(
			calls.some((request) => request.method === "DELETE" && request.url.endsWith("/trash")),
		).toBe(true);
	});

	it("skips matching active and trashed memories without overwriting local edits", async () => {
		const { fetcher, calls } = transport({
			"GET /api/admin/spaces": { items: spaces },
			"GET /api/admin/memories": {
				items: [
					{ space: "demo-test", title: "History", body: "User edits" },
					{ space: "demo-test", title: "Trash", deleted_at: "2026-10-21T00:00:00Z" },
				],
				next_cursor: null,
			},
		});
		expect(await seedDemo(spaces, memories, fetcher)).toMatchObject({ created: 0, skipped: 2 });
		expect(calls.every((request) => request.method === "GET")).toBe(true);
	});

	it("reads all pages before deciding whether a memory exists", async () => {
		const query = "?limit=200&spaces=demo-test&include=trashed";
		const { fetcher } = transport({
			[`GET /api/admin/memories${query}`]: { items: [], next_cursor: "next" },
			[`GET /api/admin/memories${query}&cursor=next`]: {
				items: memories.map((memory) => memory.create),
				next_cursor: null,
			},
		});
		expect(await seedDemo(spaces, memories, fetcher)).toMatchObject({ created: 0, skipped: 2 });
	});

	it("rejects repeated cursors rather than looping", async () => {
		const { fetcher } = transport({
			"GET /api/admin/memories": { items: [], next_cursor: "repeated" },
		});
		await expect(seedDemo(spaces, memories, fetcher)).rejects.toThrow("Repeated seed cursor");
	});

	it.each([
		{ status: "error", name: "octo", database: { connected: true }, d1_marker: null },
		{ status: "ok", name: "other", database: { connected: true }, d1_marker: null },
		{ status: "ok", name: "octo", database: { connected: false }, d1_marker: null },
		{ status: "ok", name: "octo", database: { connected: true }, d1_marker: "test" },
	])("refuses an unhealthy, unrelated or test runtime: %j", async (health) => {
		const { fetcher, calls } = transport({ "GET /api/live": health });
		await expect(seedDemo(spaces, memories, fetcher)).rejects.toThrow("daily local development");
		expect(calls.every((request) => request.method === "GET")).toBe(true);
	});

	it.each([true, null, undefined])(
		"refuses backfill unless explicitly disabled: %s",
		async (value) => {
			const { fetcher, calls } = transport({
				"GET /api/admin/settings/embedding": { backfill_enabled: value },
			});
			await expect(seedDemo(spaces, memories, fetcher)).rejects.toThrow(
				"Disable embedding backfill",
			);
			expect(calls.every((request) => request.method === "GET")).toBe(true);
		},
	);

	it("rejects occupied demo space slugs before any mutation", async () => {
		const { fetcher, calls } = transport({
			"GET /api/admin/spaces": { items: [{ ...spaces[0], description: "User space" }] },
		});
		await expect(seedDemo(spaces, memories, fetcher)).rejects.toThrow("Space slug already in use");
		expect(calls.every((request) => request.method === "GET")).toBe(true);
	});

	it("does not print response bodies or continue after HTTP errors", async () => {
		const { fetcher, calls } = transport({
			"POST /api/admin/memories": new Response("private upstream detail", { status: 403 }),
		});
		await expect(seedDemo(spaces, memories, fetcher)).rejects.toThrow(
			"Seed request failed: POST /api/admin/memories (403)",
		);
		expect(calls.at(-1)?.method).toBe("POST");
	});

	it("uses the actual fetch by default", async () => {
		const { fetcher } = transport();
		vi.stubGlobal("fetch", fetcher);
		try {
			expect(await seedDemo(spaces, memories)).toMatchObject({ created: 2 });
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("seed config and entrypoint", () => {
	it("accepts the generated daily local config", () => {
		expect(() => assertLocalSeedConfig(config)).not.toThrow();
	});
	it.each([
		"invalid toml [",
		config.replace('name = "octo"', 'name = "other"'),
		`${config}\nremote = ${"true"}`,
		`${config}\n[[vectorize]]\nbinding = "VEC"`,
		`routes = []\n${config}`,
		'name = "octo"',
		config.replace('binding = "DB"', 'binding = "OTHER"'),
		config.replace('binding = "FILES"', 'binding = "OTHER"'),
		config.replace('database_name = "octo-db"', 'database_name = "other"'),
		config.replace('bucket_name = "octo-files"', 'bucket_name = "other"'),
		config.split("[[r2_buckets]]")[0],
		`${config}\n[[d1_databases]]\nbinding = "EXTRA"`,
		`${config}\n[[r2_buckets]]\nbinding = "EXTRA"`,
	])("rejects unsafe config: %s", (toml) => {
		expect(() => assertLocalSeedConfig(String(toml))).toThrow();
	});

	it("runs the checked-in catalogue using the default config loader and fetch", async () => {
		vi.mocked(readFileSync).mockReturnValue(config);
		const { fetcher } = transport();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		vi.stubGlobal("fetch", fetcher);
		try {
			expect(await main()).toBe(0);
			expect(readFileSync).toHaveBeenCalledWith(
				expect.stringContaining(".wrangler.local.toml"),
				"utf8",
			);
			expect(log).toHaveBeenCalledWith(expect.stringContaining('"created":90'));
		} finally {
			log.mockRestore();
			vi.unstubAllGlobals();
		}
	});

	it("validates configuration before invoking the importer", async () => {
		const run = vi.fn().mockResolvedValue({ created: 90 });
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		try {
			expect(await main(run, () => config)).toBe(0);
			expect(run).toHaveBeenCalledOnce();
			expect(log).toHaveBeenCalledWith(expect.stringContaining('"created":90'));
			await expect(main(run, () => "invalid")).rejects.toThrow();
			expect(run).toHaveBeenCalledOnce();
		} finally {
			log.mockRestore();
		}
	});
});
