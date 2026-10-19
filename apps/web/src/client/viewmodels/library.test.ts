import { describe, expect, it, vi } from "vitest";
import { type AdminClient, ApiError } from "../lib/api";
import {
	type LibraryMemory,
	LibraryModel,
	libraryError,
	selectedIds,
	setSelection,
} from "./library";

export const memory = (id = "m1", patch: Partial<LibraryMemory> = {}): LibraryMemory => ({
	id,
	title: id,
	space: "work",
	tags: ["alpha", "beta"],
	version: 3,
	created_at: "2026-10-17T00:00:00.000Z",
	event_time: null,
	...patch,
});
const envelope = (items: unknown[], next_cursor: string | null = null) => ({ items, next_cursor });
function fake(replies: unknown[]) {
	const request = vi.fn(async () => {
		const result = replies.shift();
		if (result instanceof Error) throw result;
		return result;
	});
	return { api: { request } as AdminClient, request };
}

describe("library URL selection", () => {
	it("deduplicates selection and preserves unrelated URL filters", () => {
		const params = new URLSearchParams("q=hello&selected=m1&selected=m1&selected=&selected=m2");
		expect(selectedIds(params)).toEqual(["m1", "m2"]);
		expect(setSelection(params, ["m3", "m3"]).toString()).toBe("q=hello&selected=m3");
		expect(params.getAll("selected")).toHaveLength(4);
		expect(setSelection(params, []).get("q")).toBe("hello");
	});
});

describe("library data", () => {
	it("localizes known API errors and never exposes arbitrary server or network messages", () => {
		expect(libraryError(new ApiError(403, "access_denied"))).toBe(
			"没有访问权限，请重新登录或联系管理员。",
		);
		expect(libraryError(new ApiError(409, "version_conflict"))).toBe(
			"内容已被修改，请刷新后重试。",
		);
		expect(libraryError(new Error("Failed to fetch https://private.example"))).toBe(
			"请求失败，请稍后重试。",
		);
		expect(libraryError(new ApiError(500, "未知服务端内容"))).toBe("请求失败，请稍后重试。");
		expect(libraryError(new ApiError(500, "__proto__"))).toBe("请求失败，请稍后重试。");
		expect(libraryError(new Error("constructor"))).toBe("请求失败，请稍后重试。");
	});
	it.each(["graph", "timeline"] as const)(
		"loads paginated %s data without dropping old data on failure",
		async (kind) => {
			const { api, request } = fake([
				envelope([memory()], "next"),
				envelope([memory("m2")]),
				new Error("offline"),
			]);
			const model = new LibraryModel(kind, api);
			expect(await model.load()).toBe(true);
			expect(request.mock.calls).toHaveLength(2);
			expect(request).toHaveBeenNthCalledWith(2, "/memories?limit=200&cursor=next");
			expect(model.state.memories).toHaveLength(2);
			expect(await model.load()).toBe(false);
			expect(model.state).toMatchObject({
				busy: false,
				error: "请求失败，请稍后重试。",
				ready: true,
			});
			expect(model.state.memories).toHaveLength(2);
		},
	);
	it("bounds visualization data and reports truncation", async () => {
		const { api } = fake([
			envelope(
				Array.from({ length: 2000 }, (_unused, index) => memory(String(index))),
				"more",
			),
		]);
		const model = new LibraryModel("graph", api);
		await model.load();
		expect(model.state.truncated).toBe(true);
	});
	it("rejects repeated cursors rather than looping", async () => {
		const { api } = fake([envelope([], "same"), envelope([], "same")]);
		const model = new LibraryModel("timeline", api);
		expect(await model.load()).toBe(false);
		expect(model.state.error).toContain("分页游标重复");
	});
	it("ignores overlapping actions and handles unknown errors", async () => {
		let finish!: (data: unknown) => void;
		const api: AdminClient = {
			request: vi.fn(
				() =>
					new Promise((resolve) => {
						finish = resolve as typeof finish;
					}),
			) as AdminClient["request"],
		};
		const model = new LibraryModel("graph", api);
		const pending = model.load();
		expect(await model.load()).toBe(false);
		finish(envelope([]));
		await pending;
		const broken = new LibraryModel("graph", {
			request: async () => {
				throw "bad";
			},
		});
		await broken.load();
		expect(broken.state.error).toBe("请求失败，请稍后重试。");
	});
	it("loads tags and their cooccurrence source", async () => {
		const { api } = fake([
			envelope([{ id: "t", name: "alpha", display_name: "Alpha", use_count: 2 }]),
			envelope([memory()]),
		]);
		const model = new LibraryModel("tags", api);
		await model.load();
		expect(model.state.tags[0]?.use_count).toBe(2);
		expect(model.state.memories).toHaveLength(1);
	});
	it.each(["rename", "merge"] as const)(
		"%s validates a known source, target and encodes tag paths",
		async (operation) => {
			const { api, request } = fake([
				envelope([
					{ id: "t", name: "a/b", display_name: "A", use_count: 2 },
					{ id: "b", name: "beta", display_name: "Beta", use_count: 1 },
				]),
				envelope([]),
				operation === "merge"
					? { from: { name: "a/b" }, into: { name: "beta" }, memories: 5 }
					: { name: "beta" },
				envelope([]),
				envelope([]),
			]);
			const model = new LibraryModel("tags", api);
			await model.load();
			expect(await model.changeTag(operation, "missing", "beta")).toBe(false);
			expect(await model.changeTag(operation, "a/b", "a/b")).toBe(false);
			expect(await model.changeTag(operation, "a/b", " ")).toBe(false);
			if (operation === "merge")
				expect(await model.changeTag(operation, "a/b", "missing")).toBe(false);
			expect(await model.changeTag(operation, "a/b", " beta ")).toBe(true);
			expect(request).toHaveBeenCalledWith(`/tags/a%2Fb/${operation}`, {
				method: "POST",
				json: operation === "rename" ? { new_name: "beta" } : { into: "beta" },
			});
			expect(model.state.notice).toBe(
				operation === "merge" ? "已合并标签，影响 5 条记忆" : "已重命名标签",
			);
		},
	);
	it("loads spaces and key owners and creates a validated space", async () => {
		const { api, request } = fake([
			envelope([
				{
					id: "s",
					slug: "work",
					name: "Work",
					description: "",
					owner_key_id: "k",
					memory_count: 4,
				},
			]),
			envelope([{ id: "k", name: "Bot" }]),
			{},
			envelope([]),
			envelope([]),
		]);
		const model = new LibraryModel("spaces", api);
		await model.load();
		expect(model.state.spaces[0]?.memory_count).toBe(4);
		expect(model.state.keys[0]?.name).toBe("Bot");
		expect(await model.createSpace({ slug: " ", name: "Name", description: "" })).toBe(false);
		expect(await model.createSpace({ slug: "new", name: " ", description: "" })).toBe(false);
		expect(await model.createSpace({ slug: "new", name: "New", description: "Detail" })).toBe(true);
		expect(request).toHaveBeenCalledWith("/spaces", {
			method: "POST",
			json: { slug: "new", name: "New", description: "Detail" },
		});
	});
	it("reports a committed tag write as success even when revalidation fails", async () => {
		const { api, request } = fake([
			envelope([{ id: "t", name: "alpha", display_name: "Alpha", use_count: 2 }]),
			envelope([]),
			{},
			new Error("offline"),
		]);
		const model = new LibraryModel("tags", api);
		await model.load();
		expect(await model.changeTag("rename", "alpha", "new")).toBe(true);
		expect(model.state.notice).toBe("已重命名标签");
		expect(model.state.error).toBe("已保存，但刷新失败：请求失败，请稍后重试。");
		expect(model.state.tags[0]?.name).toBe("alpha");
		expect(request.mock.calls).toHaveLength(4);
	});
	it("does not suggest repeating space creation when a post-write refresh fails", async () => {
		const { api, request } = fake([{}, new Error("unavailable")]);
		const model = new LibraryModel("spaces", api);
		expect(await model.createSpace({ slug: "work", name: "Work", description: "" })).toBe(true);
		expect(model.state).toMatchObject({
			notice: "空间已创建",
			error: "已保存，但刷新失败：服务暂时不可用，请稍后重试。",
			busy: false,
		});
		expect(request.mock.calls).toHaveLength(2);
	});
});
