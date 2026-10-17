import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { client, memory } from "./__tests__/memories-fixtures";
import { EditorModel, mergeDrafts, mergeText, toDraft } from "./memories-editor";

describe("three-way merge", () => {
	it("merges independent fields and non-overlapping line edits without losing either side", () => {
		const base = toDraft({ ...memory, body: "one\ntwo\nthree\n" });
		const mine = { ...base, title: "Mine", body: "ONE\ntwo\nthree\n" };
		const theirs = { ...base, tags: ["remote"], body: "one\ntwo\nTHREE\n" };
		expect(mergeDrafts(base, mine, theirs)).toEqual({
			merged: { ...mine, tags: ["remote"], body: "ONE\ntwo\nTHREE\n" },
			conflicts: [],
		});
		expect(mergeText("a\nb", "a\nb", "A\nb")).toEqual({ text: "A\nb", conflict: false });
		expect(mergeText("a\nb", "A\nb", "a\nb")).toEqual({ text: "A\nb", conflict: false });
		expect(mergeText("a", "A", "A")).toEqual({ text: "A", conflict: false });
	});
	it("detects overlapping replacements, deletes, conflicting inserts and allows boundary inserts", () => {
		for (const [base, mine, theirs] of [
			["a", "A", "B"],
			["a\nb", "b", "A\nb"],
			["a\nb", "a\nx\nb", "a\ny\nb"],
		]) {
			expect(mergeText(base as string, mine as string, theirs as string).conflict).toBe(true);
		}
		expect(mergeText("a\nb", "A\nb", "a\nx\nb")).toEqual({ text: "A\nx\nb", conflict: false });
		expect(mergeText("a\nb", "a\nx\nb", "a\nB")).toEqual({ text: "a\nx\nB", conflict: false });
		expect(mergeText("a\nb\nc", "a\nx\nb\nc", "a\nb\nc\nz")).toEqual({
			text: "a\nx\nb\nc\nz",
			conflict: false,
		});
		const base = toDraft(memory);
		expect(
			mergeDrafts(
				base,
				{ ...base, title: "M", body: "mine" },
				{ ...base, title: "T", body: "theirs" },
			).conflicts,
		).toEqual(["title", "body"]);
	});
});

describe("EditorModel", () => {
	it("guards route departures without blocking editor pane changes or clean navigation", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		const editor = "/memories/m1/edit";
		expect(model.hasPendingChanges).toBe(false);
		expect(model.blocksNavigation(editor, "/memories/m1")).toBe(false);
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		model.update({ body: "Unsaved draft" });
		for (const destination of ["/memories/m1", "/memories", "/search", "/memories/m2/edit"])
			expect(model.blocksNavigation(editor, destination)).toBe(true);
		expect(model.blocksNavigation(editor, editor)).toBe(false);
		expect(model.state.draft?.body).toBe("Unsaved draft");
		api.request.mockRejectedValueOnce(new Error("offline"));
		await model.save();
		expect(model.hasPendingChanges).toBe(true);
		api.request.mockResolvedValueOnce({ ...memory, body: "Unsaved draft", version: 3 });
		await model.save();
		expect(model.hasPendingChanges).toBe(false);
		expect(model.blocksNavigation(editor, "/memories/m1")).toBe(false);
	});
	it("guards clean drafts while a save or upload is pending and releases failed clean work", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		let resolve!: (value: unknown) => void;
		api.request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const saving = model.save();
		expect(model.state.dirty).toBe(false);
		expect(model.hasPendingChanges).toBe(true);
		expect(model.blocksNavigation("/memories/m1/edit", "/search")).toBe(true);
		resolve({ ...memory, version: 3 });
		await saving;
		expect(model.hasPendingChanges).toBe(false);
		let reject!: (error: unknown) => void;
		api.request.mockImplementationOnce(
			() =>
				new Promise((_done, fail) => {
					reject = fail;
				}),
		);
		const uploading = model.upload(
			Object.assign(new Blob(["image"], { type: "image/png" }), { name: "photo.png" }),
		);
		expect(model.state.dirty).toBe(false);
		expect(model.hasPendingChanges).toBe(true);
		reject(new Error("upload failed"));
		await uploading;
		expect(model.hasPendingChanges).toBe(false);
	});
	it("loads, edits all fields, validates and saves with If-Match", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		await model.save();
		expect(api.request).not.toHaveBeenCalled();
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		expect(model.state.draft).toEqual(toDraft(memory));
		model.update({ title: "" });
		await model.save();
		expect(model.state.error).toBeTruthy();
		model.update({
			title: "New",
			type: "procedure",
			tags: ["a"],
			importance: 0,
			event_time: "2026-10-17T00:00:00Z",
			space: "work",
		});
		api.request.mockResolvedValueOnce({ ...memory, title: "New", version: 3 });
		await model.save();
		expect(api.request).toHaveBeenLastCalledWith("/memories/m1", {
			method: "PATCH",
			json: {
				...toDraft(memory),
				title: "New",
				type: "procedure",
				tags: ["a"],
				importance: 0,
				event_time: "2026-10-17T00:00:00Z",
				space: "work",
			},
			headers: { "If-Match": "2" },
		});
		expect(model.state.notice).toBe("已保存第 3 版");
		expect(model.state.dirty).toBe(false);
	});
	it("retains typing done while save is pending", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		model.update({ title: "First" });
		let resolve!: (value: unknown) => void;
		api.request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const saving = model.save();
		model.update({ body: "Typed later" });
		await model.save();
		resolve({ ...memory, title: "First", version: 3 });
		await saving;
		expect(model.state.draft?.body).toBe("Typed later");
		expect(model.state.base?.version).toBe(3);
		expect(model.state.dirty).toBe(true);
	});
	it("loads current on conflict and requires explicit field resolution before rebasing", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		model.update({ title: "Mine" });
		api.request
			.mockRejectedValueOnce(new ApiError(409, "version_conflict"))
			.mockResolvedValueOnce({ ...memory, title: "Theirs", tags: ["remote"], version: 3 });
		await model.save();
		expect(model.state.conflict?.base.title).toBe("Title");
		expect(model.state.conflict?.mine.title).toBe("Mine");
		expect(model.state.conflict?.theirs.title).toBe("Theirs");
		model.finishMerge();
		expect(model.state.conflict).not.toBeNull();
		await model.save();
		expect(api.request).toHaveBeenCalledTimes(3);
		model.resolveField("title", "Mine + theirs");
		model.finishMerge();
		expect(model.state.draft?.tags).toEqual(["remote"]);
		expect(model.state.base?.version).toBe(3);
		expect(model.state.conflict).toBeNull();
		api.request.mockResolvedValueOnce({
			...memory,
			title: "Mine + theirs",
			tags: ["remote"],
			version: 4,
		});
		await model.save();
		expect(api.request.mock.calls.at(-1)?.[1]?.headers).toEqual({ "If-Match": "3" });
		model.resolveField("title", "ignored");
		model.finishMerge();
		model.cancelMerge();
	});
	it("automatically proposes clean three-way merge but never silently overwrites on conflict", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		model.update({ title: "Mine" });
		api.request
			.mockRejectedValueOnce(new ApiError(409, "version_conflict"))
			.mockResolvedValueOnce({ ...memory, tags: ["remote"], version: 3 });
		await model.save();
		expect(model.state.conflict?.unresolved).toEqual([]);
		model.cancelMerge();
		expect(model.state.draft?.title).toBe("Mine");
		expect(model.state.base?.version).toBe(2);
		api.request
			.mockRejectedValueOnce(new ApiError(409, "version_conflict"))
			.mockResolvedValueOnce({ ...memory, tags: ["remote"], version: 3 });
		await model.save();
		model.finishMerge();
		expect(model.state.draft?.title).toBe("Mine");
		expect(model.state.draft?.tags).toEqual(["remote"]);
		model.cancelMerge();
		expect(model.state.conflict).toBeNull();
	});
	it("retains unsaved data on network, conflict refresh and load failures", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		model.update({ title: "ignored" });
		api.request.mockRejectedValueOnce(new Error("load"));
		await model.load();
		expect(model.state.error).toBe("请求失败，请稍后重试。");
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		model.update({ body: "Unsaved" });
		api.request.mockRejectedValueOnce(new Error("offline"));
		await model.save();
		expect(model.state.error).toBe("请求失败，请稍后重试。");
		api.request
			.mockRejectedValueOnce(new ApiError(409, "version_conflict"))
			.mockRejectedValueOnce(new Error("refresh failed"));
		await model.save();
		expect(model.state.error).toBe("请求失败，请稍后重试。");
		expect(model.state.draft?.body).toBe("Unsaved");
	});
	it("uploads one-part multipart bodies (including Unicode filenames) and inserts safe octo references", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		const file = Object.assign(new Blob(["image"], { type: "image/png" }), { name: "photo.png" });
		await model.upload(file);
		expect(api.request).not.toHaveBeenCalled();
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		api.request.mockResolvedValueOnce({
			id: "a1",
			filename: "photo.png",
			markdown: "![](octo://att/a1)",
		});
		await model.upload(file);
		expect(api.request).toHaveBeenLastCalledWith("/memories/m1/attachments", {
			method: "POST",
			body: expect.any(FormData),
		});
		const form = api.request.mock.calls.at(-1)?.[1]?.body as FormData;
		expect([...form.keys()]).toEqual(["file"]);
		expect((form.get("file") as File).name).toBe("photo.png");
		expect(model.state.draft?.body).toContain("![](octo://att/a1)");
		const pdf = Object.assign(new Blob(["pdf"], { type: "application/pdf" }), {
			name: "报告 [x].pdf",
		});
		api.request.mockResolvedValueOnce({ id: "a2", filename: pdf.name });
		await model.upload(pdf);
		expect(model.state.draft?.body).toContain("[报告 \\[x\\].pdf](octo://att/a2)");
		const pdfForm = api.request.mock.calls.at(-1)?.[1]?.body as FormData;
		expect((pdfForm.get("file") as File).name).toBe(pdf.name);
		api.request.mockRejectedValueOnce(new Error("upload failed"));
		await model.upload(file);
		expect(model.state.error).toBe("请求失败，请稍后重试。");
	});
	it("rejects oversize or unsupported attachments before making requests", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		await model.upload({ name: "x", size: 50 * 1024 * 1024 + 1, type: "image/png" } as Blob & {
			name: string;
		});
		expect(model.state.error).toContain("50 MiB");
		await model.upload(
			Object.assign(new Blob(["x"], { type: "application/javascript" }), { name: "x.js" }),
		);
		expect(model.state.error).toContain("图片或 PDF");
		expect(api.request).toHaveBeenCalledTimes(1);
	});
	it("ignores overlapping stale loads so a late response cannot erase the current draft", async () => {
		const api = client();
		const model = new EditorModel("m1", api.api);
		let resolve!: (value: unknown) => void;
		api.request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const first = model.load();
		api.request.mockResolvedValueOnce({ ...memory, version: 3 });
		await model.load();
		model.update({ body: "Unsaved" });
		resolve(memory);
		await first;
		expect(model.state.base?.version).toBe(3);
		expect(model.state.draft?.body).toBe("Unsaved");
		let reject!: (error: unknown) => void;
		api.request.mockImplementationOnce(
			() =>
				new Promise((_done, fail) => {
					reject = fail;
				}),
		);
		const stale = model.load();
		api.request.mockResolvedValueOnce(memory);
		await model.load();
		reject(new Error("old"));
		await stale;
		expect(model.state.error).toBeNull();
	});
});
