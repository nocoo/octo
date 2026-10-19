import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { client, memory } from "./__tests__/memories-fixtures";
import {
	errorMessage,
	filtersFromUrl,
	HistoryModel,
	MemoriesModel,
	type Memory,
	MemoryModel,
	type MemoryVersion,
	memoryQuery,
} from "./memories";

it("localizes API and validation errors without exposing server diagnostics", () => {
	expect(errorMessage(new ApiError(403, "access_denied"))).toBe("无权访问，请检查登录状态。");
	expect(errorMessage(new ApiError(500, "sensitive diagnostic"))).toBe("请求失败，请稍后重试。");
	expect(errorMessage(new Error("private upstream response"))).toBe("请求失败，请稍后重试。");
	expect(errorMessage(new Error("重要性下限不能超过上限。"))).toBe("重要性下限不能超过上限。");
	try {
		filtersFromUrl(new URLSearchParams("types=invalid"));
	} catch (error) {
		expect(errorMessage(error)).toBe("输入格式不正确，请检查填写内容。");
	}
});

describe("memory filters", () => {
	it("round-trips every supported filter, pagination and URL-only display state", () => {
		const url = new URLSearchParams(
			"spaces=notes,work&tags_all=a,b&tags_any=c&types=note&sources=k1&time_field=event&time_from=2026-01-01T00%3A00%3A00Z&time_to=2026-12-01T00%3A00%3A00Z&importance_min=0&importance_max=1&limit=20&cursor=a%2Bb&view=cards&selected=m1",
		);
		expect(filtersFromUrl(url)).toEqual({
			spaces: ["notes", "work"],
			tags_all: ["a", "b"],
			tags_any: ["c"],
			types: ["note"],
			sources: ["k1"],
			time: { field: "event", from: "2026-01-01T00:00:00Z", to: "2026-12-01T00:00:00Z" },
			importance: { min: 0, max: 1 },
		});
		const query = new URLSearchParams(memoryQuery(url));
		expect(query.get("cursor")).toBe("a+b");
		expect(query.has("view")).toBe(false);
		expect(query.has("selected")).toBe(false);
		expect(query.get("limit")).toBe("20");
	});
	it("defaults empty filters, rejects invalid ranges and preserves one-sided filters", () => {
		expect(filtersFromUrl(new URLSearchParams())).toEqual({});
		expect(memoryQuery(new URLSearchParams())).toBe("limit=50");
		expect(
			new URLSearchParams(
				memoryQuery(new URLSearchParams("time_from=2026-01-01T00%3A00%3A00Z")),
			).get("time_field"),
		).toBe("updated");
		expect(() =>
			filtersFromUrl(
				new URLSearchParams(
					"time_from=2026-01-01T00%3A00%3A00Z&time_to=2026-01-01T00%3A00%3A00.001Z",
				),
			),
		).not.toThrow();
		expect(
			filtersFromUrl(
				new URLSearchParams("tags_any=,,&time_from=2026-01-01T00%3A00%3A00Z&importance_max=0.8"),
			),
		).toEqual({
			time: { field: "updated", from: "2026-01-01T00:00:00Z" },
			importance: { max: 0.8 },
		});
		for (const query of [
			"importance_min=x",
			"importance_min=0.9&importance_max=0.1",
			"time_field=no",
			"time_field=created&time_from=2026-12-01T00%3A00%3A00Z&time_to=2026-01-01T00%3A00%3A00Z",
			"limit=201",
			"limit=abc",
		]) {
			expect(() => memoryQuery(new URLSearchParams(query))).toThrow();
		}
	});
});

describe("MemoriesModel", () => {
	it("loads pages, retains cached data on refresh, and surfaces failures", async () => {
		const api = client();
		const model = new MemoriesModel(api.api);
		api.request.mockResolvedValueOnce({ items: [memory], next_cursor: "next" });
		await model.load(new URLSearchParams());
		expect(api.request).toHaveBeenLastCalledWith("/memories?limit=50");
		expect(model.state.items).toEqual([memory]);
		api.request.mockImplementationOnce(async () => {
			expect(model.state.items).toEqual([memory]);
			throw new Error("offline");
		});
		await model.load(new URLSearchParams());
		expect(model.state.error).toBe("请求失败，请稍后重试。");
		expect(model.state.nextCursor).toBe("next");
		await model.load(new URLSearchParams("importance_min=bad"));
		expect(model.state.error).toBeTruthy();
	});
	it("ignores stale results and stale errors after URL changes", async () => {
		const api = client();
		const model = new MemoriesModel(api.api);
		let resolve!: (value: unknown) => void;
		api.request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const first = model.load(new URLSearchParams());
		api.request.mockResolvedValueOnce({ items: [], next_cursor: null });
		await model.load(new URLSearchParams("spaces=other"));
		resolve({ items: [memory], next_cursor: "old" });
		await first;
		expect(model.state.items).toEqual([]);
		let reject!: (error: unknown) => void;
		api.request.mockImplementationOnce(
			() =>
				new Promise((_done, fail) => {
					reject = fail;
				}),
		);
		const stale = model.load(new URLSearchParams());
		api.request.mockResolvedValueOnce({ items: [memory], next_cursor: null });
		await model.load(new URLSearchParams("spaces=other"));
		reject("old");
		await stale;
		expect(model.state.error).toBeNull();
	});
});

describe("MemoryModel", () => {
	it("consumes raw M7 detail summaries, version metadata and signed attachment URLs", async () => {
		const api = client();
		const attachment = {
			id: "a1",
			filename: "image.png",
			content_type: "image/png",
			size_bytes: 42,
			sha256: "hash",
			created_at: "2026-10-18T00:00:00.000Z",
		};
		const detail = {
			...memory,
			attachments: [attachment],
			versions_count: 1,
			vector_status: [
				{ profile: "te3-small-1536", indexed: false, stale: true, embedding_calls: 0 },
			],
		} satisfies Memory;
		const version = {
			memory_id: memory.id,
			version: 2,
			title: memory.title,
			type: memory.type,
			importance: memory.importance,
			tags: memory.tags,
			event_time: null,
			space_id: "s1",
			actor: "admin:owner@example.com",
			op: "update",
			rollback_of: null,
			created_at: "2026-10-18T00:00:00.000Z",
		} satisfies MemoryVersion;
		api.request
			.mockResolvedValueOnce(detail)
			.mockResolvedValueOnce({ items: [version] })
			.mockResolvedValueOnce({
				url: "https://octo.hexly.ai/files/a1?exp=3&sig=abc",
				expires_at: "2026-10-18T00:05:00.000Z",
			});
		const model = new MemoryModel("m1", api.api, () => 0);
		await model.load();
		expect(model.state.memory?.attachments).toEqual([attachment]);
		expect(model.state.memory?.vector_status).toEqual(detail.vector_status);
		expect(model.state.versions).toEqual([version]);
		expect(model.state.urls.a1).toBe("https://octo.hexly.ai/files/a1?exp=3&sig=abc");
	});
	it("ignores stale read responses and stale read errors", async () => {
		const api = client();
		const model = new MemoryModel("m1", api.api);
		let resolve!: (value: unknown) => void;
		api.request
			.mockImplementationOnce(
				() =>
					new Promise((done) => {
						resolve = done;
					}),
			)
			.mockResolvedValueOnce({ items: [] });
		const first = model.load();
		api.request
			.mockResolvedValueOnce({ ...memory, version: 3 })
			.mockResolvedValueOnce({ items: [] });
		await model.load();
		resolve(memory);
		await first;
		expect(model.state.memory?.version).toBe(3);
		let reject!: (error: unknown) => void;
		api.request
			.mockImplementationOnce(
				() =>
					new Promise((_done, fail) => {
						reject = fail;
					}),
			)
			.mockResolvedValueOnce({ items: [] });
		const stale = model.load();
		api.request.mockResolvedValueOnce(memory).mockResolvedValueOnce({ items: [] });
		await model.load();
		reject(new Error("old"));
		await stale;
		expect(model.state.error).toBeNull();
	});
	it("loads metadata, timeline and signed attachment URLs, renewing expired links", async () => {
		const api = client();
		const now = vi.fn(() => 0);
		const model = new MemoryModel("m1", api.api, now);
		api.request
			.mockResolvedValueOnce({
				...memory,
				body: "![](octo://att/a2)",
				attachments: [{ id: "a1", filename: "image.png" }],
			})
			.mockResolvedValueOnce({ items: [{ version: 1 }] })
			.mockResolvedValue({ url: "/files/signed", expires_at: "2026-10-17T00:00:00Z" });
		await model.load();
		expect(model.state.urls).toEqual({ a1: "/files/signed", a2: "/files/signed" });
		expect(model.state.versions).toEqual([{ version: 1 }]);
		await expect(model.attachmentUrl("a1")).resolves.toBe("/files/signed");
		expect(api.request).toHaveBeenCalledTimes(4);
		now.mockReturnValue(Date.parse("2026-10-17T00:00:00Z"));
		await model.attachmentUrl("a1");
		expect(api.request).toHaveBeenCalledTimes(5);
	});
	it("supports no attachments and displays read/signing errors", async () => {
		const api = client();
		const model = new MemoryModel("m1", api.api);
		api.request.mockResolvedValueOnce(memory).mockResolvedValueOnce({ items: [] });
		await model.load();
		expect(model.state.memory).toEqual(memory);
		api.request.mockRejectedValueOnce(new Error("offline"));
		await expect(model.attachmentUrl("bad")).rejects.toThrow("offline");
		api.request
			.mockRejectedValueOnce(new ApiError(404, "not_found"))
			.mockResolvedValueOnce({ items: [] });
		await model.load();
		expect(model.state.error).toBe("内容不存在或无权访问。");
		api.request.mockRejectedValueOnce("broken").mockResolvedValueOnce({ items: [] });
		await model.load();
		expect(model.state.error).toBe("请求失败，请稍后重试。");
	});
});

describe("HistoryModel", () => {
	it("retries a rejected diff with the same URL comparison instead of clearing the selection", async () => {
		const api = client();
		const model = new HistoryModel("m1", api.api);
		const params = new URLSearchParams("from=1&to=2&diff=split");
		const diff = {
			from: 1,
			to: 2,
			fields: [{ field: "title", from: "Old", to: "Title" }],
			body: { unified: "-old\n+new", hunks: [] },
		};
		api.request
			.mockResolvedValueOnce(memory)
			.mockResolvedValueOnce({ items: [{ version: 1 }, { version: 2 }] })
			.mockRejectedValueOnce(new Error("diff unavailable"));
		await model.loadFromUrl(params);
		expect(model.state.error).toBe("请求失败，请稍后重试。");
		expect(model.state.diff).toBeNull();
		api.request
			.mockResolvedValueOnce(memory)
			.mockResolvedValueOnce({ items: [{ version: 1 }, { version: 2 }] })
			.mockResolvedValueOnce(diff);
		await model.loadFromUrl(params);
		expect(model.state.error).toBeNull();
		expect(model.state.diff).toEqual(diff);
		expect(params.toString()).toBe("from=1&to=2&diff=split");
		expect(api.request.mock.calls.filter(([path]) => path.includes("/diff?"))).toEqual([
			["/memories/m1/diff?from=1&to=2"],
			["/memories/m1/diff?from=1&to=2"],
		]);
		api.request.mockResolvedValueOnce(memory).mockResolvedValueOnce({ items: [] });
		await model.loadFromUrl(new URLSearchParams());
		expect(model.state.diff).toBeNull();
	});
	it("ignores stale loads and comparisons after a newer URL selection", async () => {
		const api = client();
		const model = new HistoryModel("m1", api.api);
		let resolve!: (value: unknown) => void;
		api.request
			.mockImplementationOnce(
				() =>
					new Promise((done) => {
						resolve = done;
					}),
			)
			.mockResolvedValueOnce({ items: [] });
		const first = model.load();
		api.request
			.mockResolvedValueOnce({ ...memory, version: 3 })
			.mockResolvedValueOnce({ items: [] });
		await model.load();
		resolve(memory);
		await first;
		expect(model.state.current?.version).toBe(3);
		let reject!: (error: unknown) => void;
		api.request
			.mockImplementationOnce(
				() =>
					new Promise((_done, fail) => {
						reject = fail;
					}),
			)
			.mockResolvedValueOnce({ items: [] });
		const stale = model.load();
		api.request.mockResolvedValueOnce(memory).mockResolvedValueOnce({ items: [] });
		await model.load();
		reject(new Error("old"));
		await stale;
		expect(model.state.error).toBeNull();
		api.request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const comparison = model.compare(1, 2);
		api.request.mockResolvedValueOnce({
			from: 2,
			to: 3,
			fields: [],
			body: { hunks: [], unified: "" },
		});
		await model.compare(2, 3);
		resolve({ from: 1, to: 2 });
		await comparison;
		expect(model.state.diff?.from).toBe(2);
		api.request.mockImplementationOnce(
			() =>
				new Promise((_done, fail) => {
					reject = fail;
				}),
		);
		const failed = model.compare(1, 2);
		api.request.mockResolvedValueOnce({
			from: 2,
			to: 3,
			fields: [],
			body: { hunks: [], unified: "" },
		});
		await model.compare(2, 3);
		reject(new Error("old"));
		await failed;
		expect(model.state.error).toBeNull();
	});
	it("loads current version and metadata, compares actual field/body diffs and confirms rollback", async () => {
		const api = client();
		const model = new HistoryModel("m1", api.api);
		api.request
			.mockResolvedValueOnce(memory)
			.mockResolvedValueOnce({ items: [{ version: 1 }, { version: 2 }] })
			.mockResolvedValueOnce({
				from: 1,
				to: 2,
				fields: [{ field: "title", from: "Old", to: "Title" }],
				body: { unified: "-old\n+new", hunks: [] },
			});
		await model.load(1, 2);
		expect(model.state.diff?.fields[0]?.field).toBe("title");
		model.requestRollback(1);
		expect(model.state.rollbackTarget).toBe(1);
		model.cancelRollback();
		expect(model.state.rollbackTarget).toBeNull();
		await model.rollback();
		expect(api.request).toHaveBeenCalledTimes(3);
		model.requestRollback(1);
		api.request
			.mockResolvedValueOnce({ ...memory, version: 3 })
			.mockResolvedValueOnce({ ...memory, version: 3 })
			.mockResolvedValueOnce({ items: [{ version: 1 }, { version: 2 }, { version: 3 }] });
		await model.rollback();
		expect(api.request).toHaveBeenCalledWith("/memories/m1/rollback", {
			method: "POST",
			json: { to_version: 1 },
			headers: { "If-Match": "2" },
		});
		expect(model.state.current?.version).toBe(3);
		expect(model.state.notice).toBe("回滚已生成第 3 版");
	});
	it("handles single-version histories and failed compare/load/rollback", async () => {
		const api = client();
		const model = new HistoryModel("m1", api.api);
		api.request.mockResolvedValueOnce(memory).mockResolvedValueOnce({ items: [{ version: 2 }] });
		await model.load();
		expect(model.state.diff).toBeNull();
		api.request.mockRejectedValueOnce(new Error("diff failed"));
		await model.compare(1, 2);
		expect(model.state.error).toBe("请求失败，请稍后重试。");
		model.requestRollback(1);
		api.request.mockRejectedValueOnce(new ApiError(409, "version_conflict"));
		await model.rollback();
		expect(model.state.error).toBe("版本已更新，请刷新后重试。");
		expect(model.state.rollbackTarget).toBe(1);
		api.request
			.mockRejectedValueOnce(new Error("load failed"))
			.mockResolvedValueOnce({ items: [] });
		await model.load();
		expect(model.state.error).toBe("请求失败，请稍后重试。");
		const empty = new HistoryModel("m1", api.api);
		empty.requestRollback(1);
		await empty.rollback();
	});
});
