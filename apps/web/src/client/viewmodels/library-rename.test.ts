import { describe, expect, it, vi } from "vitest";
import { type AdminClient, ApiError } from "../lib/api";
import { LibraryModel, type LibrarySpace } from "./library";

const space: LibrarySpace = {
	id: "space-id",
	slug: "work",
	name: "原始空间",
	description: "保留说明",
	owner_key_id: null,
	memory_count: 3,
	updated_at: "2026-10-20T04:00:00.123Z",
};
const draft = { name: "新名称", slug: "renamed-work" };
function setup(failure?: Error) {
	const renamed = { ...space, ...draft };
	const request = vi.fn(async (path: string, options?: { method?: string }) => {
		if (options?.method === "PATCH") {
			if (failure) throw failure;
			return renamed;
		}
		return { items: path === "/spaces" ? [renamed] : [], next_cursor: null };
	});
	const model = new LibraryModel("spaces", { request } as AdminClient);
	model.state = { ...model.state, spaces: [space], ready: true };
	return { model, request };
}

describe("space rename model", () => {
	it("sends the new slug and trimmed name to the old canonical path with its timestamp", async () => {
		const { model, request } = setup();
		expect(await model.renameSpace(space, { ...draft, name: " 新名称 " })).toBe(true);
		expect(request).toHaveBeenNthCalledWith(1, "/spaces/work", {
			method: "PATCH",
			headers: { "If-Match": String(Date.parse(space.updated_at)) },
			json: draft,
		});
		expect(model.state.spaces).toEqual([{ ...space, ...draft }]);
		expect(model.state.notice).toBe("空间已重命名");
		expect(model.state.renameFieldErrors).toEqual({});
		expect(model.state.busy).toBe(false);
	});
	it.each(["", "   ", "字".repeat(257)])(
		"rejects invalid names locally and points to the name field",
		async (name) => {
			const { model, request } = setup();
			expect(await model.renameSpace(space, { ...draft, name })).toBe(false);
			expect(model.state.renameFieldErrors.name).toBe("请输入 1 至 256 个字符的空间名称。");
			expect(request).not.toHaveBeenCalled();
		},
	);
	it("accepts the shared schema's maximum length", async () => {
		const { model, request } = setup();
		expect(await model.renameSpace(space, { ...draft, name: "字".repeat(256) })).toBe(true);
		expect(request.mock.calls[0]?.[1]).toMatchObject({ json: { name: "字".repeat(256) } });
	});
	it("maps server name issues and clears them when the form is reset", async () => {
		const { model } = setup(new ApiError(400, "validation_failed", { issues: [{ path: "name" }] }));
		expect(await model.renameSpace(space, draft)).toBe(false);
		expect(model.state.renameFieldErrors).toEqual({ name: "请输入 1 至 256 个字符的空间名称。" });
		expect(model.state.spaces).toEqual([space]);
		model.resetSpaceRename();
		expect(model.state.renameFieldErrors).toEqual({});
		expect(model.state.error).toBeNull();
	});
	it.each([
		new ApiError(400, "validation_failed", { issues: [{ path: "description" }] }),
		new ApiError(412, "version_conflict"),
		new ApiError(409, "version_conflict"),
		new ApiError(409, "other_conflict"),
		new ApiError(409, "version_conflict", { issues: [{ path: "description" }] }),
		new ApiError(503, "unavailable"),
		new Error("private database error"),
	])("keeps unrelated and request errors out of the name field: %s", async (error) => {
		const { model } = setup(error);
		expect(await model.renameSpace(space, draft)).toBe(false);
		expect(model.state.renameFieldErrors).toEqual({});
		expect(model.state.error).toBeTruthy();
		expect(model.state.error).not.toContain("private");
		expect(model.state.busy).toBe(false);
	});
	it("blocks duplicate submission while pending", async () => {
		const { model, request } = setup();
		model.state = { ...model.state, busy: true };
		const pendingState = model.state;
		model.resetSpaceRename();
		expect(model.state).toBe(pendingState);
		expect(await model.renameSpace(space, draft)).toBe(false);
		expect(request).not.toHaveBeenCalled();
	});
	it("keeps a committed rename successful when list refresh fails", async () => {
		const { model, request } = setup();
		const other = { ...space, id: "other-id", slug: "other" };
		model.state = { ...model.state, spaces: [space, other] };
		request.mockReset();
		request
			.mockResolvedValueOnce({ ...space, ...draft })
			.mockRejectedValueOnce(new ApiError(503, "unavailable"));
		expect(await model.renameSpace(space, draft)).toBe(true);
		expect(model.state.notice).toBe("空间已重命名");
		expect(model.state.error).toContain("已保存，但刷新失败");
		expect(model.state.spaces).toEqual([{ ...space, ...draft }, other]);
	});
	it.each(["", " ", "Work", "a--b", "-work", "work-", "a_b", "a".repeat(65)])(
		"rejects invalid slugs locally without a write: %s",
		async (slug) => {
			const { model, request } = setup();
			expect(await model.renameSpace(space, { ...draft, slug })).toBe(false);
			expect(model.state.renameFieldErrors).toEqual({
				slug: "请输入 1 至 64 位小写字母、数字与单连字符，不能以连字符开头或结尾。",
			});
			expect(request).not.toHaveBeenCalled();
		},
	);
	it.each(["a", "a".repeat(64), "work-notes"])("accepts valid slug %s", async (slug) => {
		const { model, request } = setup();
		expect(await model.renameSpace(space, { ...draft, slug })).toBe(true);
		expect(request.mock.calls[0]?.[1]).toMatchObject({ json: { ...draft, slug } });
	});
	it("shows a Chinese duplicate slug field error without changing the list", async () => {
		const { model } = setup(new ApiError(409, "version_conflict", { issues: [{ path: "slug" }] }));
		expect(await model.renameSpace(space, draft)).toBe(false);
		expect(model.state.renameFieldErrors).toEqual({ slug: "空间标识已被占用，请使用其他标识。" });
		expect(model.state.spaces).toEqual([space]);
		model.resetSpaceRename();
		expect(model.state.renameFieldErrors).toEqual({});
	});
	it("maps server slug validation to the shared localized field message", async () => {
		const { model } = setup(new ApiError(400, "validation_failed", { issues: [{ path: "slug" }] }));
		expect(await model.renameSpace(space, draft)).toBe(false);
		expect(model.state.renameFieldErrors.slug).toContain("1 至 64");
	});
});
