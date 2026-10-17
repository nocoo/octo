import { describe, expect, it, vi } from "vitest";
import type { AdminClient } from "../lib/api";
import { type LibraryMemory, LibraryModel, selectedIds } from "./library";

const memory = (id: string): LibraryMemory => ({
	id,
	title: id,
	space: "work",
	tags: [],
	version: 1,
	created_at: "2026-10-17T00:00:00Z",
	event_time: null,
});
const page = (items: LibraryMemory[], next_cursor: string | null = null) => ({
	items,
	next_cursor,
});
function fake(replies: unknown[]) {
	const request = vi.fn(async () => {
		const reply = replies.shift();
		if (reply instanceof Error) throw reply;
		return reply;
	});
	return { api: { request } as AdminClient, request };
}

describe("trash server pagination", () => {
	it("loads one server page at a time and reaches restore and purge targets beyond 2000 rows", async () => {
		const pages = Array.from({ length: 11 }, (_, index) =>
			page(
				Array.from({ length: 200 }, (_, offset) => memory(String(index * 200 + offset))),
				index === 10 ? null : `page ${index + 1}`,
			),
		);
		const { api, request } = fake([...pages, {}, {}]);
		const model = new LibraryModel("trash", api);
		expect(await model.load()).toBe(true);
		expect(request).toHaveBeenCalledTimes(1);
		expect(model.state).toMatchObject({ nextCursor: "page 1", truncated: false });
		expect(model.state.memories).toHaveLength(200);
		for (let index = 0; index < 10; index++) expect(await model.loadMore()).toBe(true);
		expect(request).toHaveBeenCalledTimes(11);
		expect(request).toHaveBeenNthCalledWith(11, "/trash?limit=200&cursor=page+10");
		expect(model.state.memories).toHaveLength(2200);
		expect(model.state.nextCursor).toBeNull();
		expect(await model.restore(["2199"])).toBe(true);
		model.beginPurge("2198");
		expect(model.confirmPurgeTitle("2198")).toBe(true);
		expect(await model.purge()).toBe(true);
		expect(request).toHaveBeenCalledWith("/trash/2199/restore", { method: "POST" });
		expect(request).toHaveBeenCalledWith("/trash/2198", { method: "DELETE" });
	});
	it("preserves URL selection, prior rows and partial restore failures while appending deduplicated pages", async () => {
		const { api } = fake([
			page([memory("a"), memory("b")], "next"),
			{},
			new Error("conflict"),
			page([memory("b"), memory("c")]),
		]);
		const model = new LibraryModel("trash", api);
		await model.load();
		await model.restore(["a", "b"]);
		const params = new URLSearchParams("selected=b&q=old");
		expect(await model.loadMore()).toBe(true);
		expect(selectedIds(params)).toEqual(["b"]);
		expect(model.state.memories.map((item) => item.id)).toEqual(["b", "c"]);
		expect(model.state.failures).toEqual([{ id: "b", message: "conflict" }]);
		expect(model.state.notice).toBe("Restored 1 of 2 memories");
	});
	it("keeps the failed page cursor and cached rows available for an explicit retry", async () => {
		const { api, request } = fake([
			page([memory("a")], "a/b+c"),
			new Error("offline"),
			page([memory("b")]),
		]);
		const model = new LibraryModel("trash", api);
		await model.load();
		expect(await model.loadMore()).toBe(false);
		expect(model.state).toMatchObject({ nextCursor: "a/b+c", error: "offline", busy: false });
		expect(model.state.memories.map((item) => item.id)).toEqual(["a"]);
		expect(await model.loadMore()).toBe(true);
		expect(request).toHaveBeenNthCalledWith(3, "/trash?limit=200&cursor=a%2Fb%2Bc");
		expect(model.state.error).toBeNull();
	});
	it("does not request missing cursors, other library kinds or overlapping pages", async () => {
		const { api, request } = fake([page([], "next")]);
		expect(await new LibraryModel("trash", api).loadMore()).toBe(false);
		expect(await new LibraryModel("graph", api).loadMore()).toBe(false);
		expect(request).not.toHaveBeenCalled();
		const model = new LibraryModel("trash", api);
		await model.load();
		let finish!: (value: unknown) => void;
		api.request = vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		) as AdminClient["request"];
		const pending = model.loadMore();
		expect(await model.loadMore()).toBe(false);
		finish(page([memory("a")]));
		expect(await pending).toBe(true);
		expect(await model.loadMore()).toBe(false);
	});
	it("rejects cursor cycles and resets cursor history after refreshing the first page", async () => {
		const { api } = fake([
			page([memory("a")], "next"),
			page([memory("b")], "next"),
			page([memory("fresh")], "next"),
			page([memory("last")]),
		]);
		const model = new LibraryModel("trash", api);
		await model.load();
		expect(await model.loadMore()).toBe(false);
		expect(model.state.error).toContain("cursor");
		expect(model.state.memories.map((item) => item.id)).toEqual(["a"]);
		expect(await model.load()).toBe(true);
		expect(model.state.memories.map((item) => item.id)).toEqual(["fresh"]);
		expect(await model.loadMore()).toBe(true);
	});
});
