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
};
function setup(failure?: Error) {
	const renamed = { ...space, name: "新名称" };
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
	it("sends only a trimmed name to the existing admin PATCH and refreshes the list", async () => {
		const { model, request } = setup();
		expect(await model.renameSpace("work", " 新名称 ")).toBe(true);
		expect(request).toHaveBeenNthCalledWith(1, "/spaces/work", {
			method: "PATCH",
			json: { name: "新名称" },
		});
		expect(model.state.spaces).toEqual([{ ...space, name: "新名称" }]);
		expect(model.state.notice).toBe("空间已重命名");
		expect(model.state.renameFieldErrors).toEqual({});
		expect(model.state.busy).toBe(false);
	});
	it.each(["", "   ", "字".repeat(257)])(
		"rejects invalid names locally and points to the name field",
		async (name) => {
			const { model, request } = setup();
			expect(await model.renameSpace("work", name)).toBe(false);
			expect(model.state.renameFieldErrors.name).toBe("请输入 1 至 256 个字符的空间名称。");
			expect(request).not.toHaveBeenCalled();
		},
	);
	it("accepts the shared schema's maximum length", async () => {
		const { model, request } = setup();
		expect(await model.renameSpace("work", "字".repeat(256))).toBe(true);
		expect(request.mock.calls[0]?.[1]).toMatchObject({ json: { name: "字".repeat(256) } });
	});
	it("maps server name issues and clears them when the form is reset", async () => {
		const { model } = setup(new ApiError(400, "validation_failed", { issues: [{ path: "name" }] }));
		expect(await model.renameSpace("work", "新名称")).toBe(false);
		expect(model.state.renameFieldErrors).toEqual({ name: "请输入 1 至 256 个字符的空间名称。" });
		expect(model.state.spaces).toEqual([space]);
		model.resetSpaceRename();
		expect(model.state.renameFieldErrors).toEqual({});
		expect(model.state.error).toBeNull();
	});
	it.each([
		new ApiError(400, "validation_failed", { issues: [{ path: "description" }] }),
		new ApiError(409, "version_conflict"),
		new ApiError(503, "unavailable"),
		new Error("private database error"),
	])("keeps unrelated and request errors out of the name field: %s", async (error) => {
		const { model } = setup(error);
		expect(await model.renameSpace("work", "新名称")).toBe(false);
		expect(model.state.renameFieldErrors).toEqual({});
		expect(model.state.error).toBeTruthy();
		expect(model.state.error).not.toContain("private");
		expect(model.state.busy).toBe(false);
	});
	it("blocks duplicate submission while pending", async () => {
		const { model, request } = setup();
		model.state = { ...model.state, busy: true };
		expect(await model.renameSpace("work", "新名称")).toBe(false);
		expect(request).not.toHaveBeenCalled();
	});
	it("keeps a committed rename successful when list refresh fails", async () => {
		const { model, request } = setup();
		request.mockReset();
		request
			.mockResolvedValueOnce({ ...space, name: "新名称" })
			.mockRejectedValueOnce(new ApiError(503, "unavailable"));
		expect(await model.renameSpace("work", "新名称")).toBe(true);
		expect(model.state.notice).toBe("空间已重命名");
		expect(model.state.error).toContain("已保存，但刷新失败");
	});
});
