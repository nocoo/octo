import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { KeysModel, rolePermissions } from "./operations-keys";

const space = { id: "opaque-space-id", slug: "research", name: "Research" };
const permissions = { ...rolePermissions("custom"), ops: "r,w", space_ids: [space.id] };
const draft = { name: "Research agent", role: "custom" as const, expires_at: null, permissions };

describe("key form contract and validation", () => {
	it("persists permitted readonly space changes rather than discarding the picker selection", async () => {
		const request = vi.fn().mockResolvedValue({ items: [space] });
		const model = new KeysModel({ request });
		await model.loadSpaces();
		const readonly = {
			...rolePermissions("readonly"),
			scope: "spaces" as const,
			space_ids: [space.id],
		};
		expect(
			await model.update("readonly", {
				name: "Reader",
				role: "readonly",
				expires_at: null,
				permissions: readonly,
			}),
		).toBe(true);
		expect(request).toHaveBeenCalledWith("/keys/readonly", {
			method: "PATCH",
			json: { role: "readonly", expires_at: null, scope: "spaces", space_ids: [space.id] },
		});
		expect(
			await model.update("readonly", {
				role: "readonly",
				expires_at: null,
				permissions: { ...readonly, space_ids: [space.slug] },
			}),
		).toBe(false);
		expect(model.state.fieldErrors.space_ids).toBeTruthy();
	});
	it("creates restricted readonly keys and rejects a scope forbidden by the template", async () => {
		const request = vi.fn().mockResolvedValue({ items: [space], plaintext: "once" });
		const model = new KeysModel({ request });
		await model.loadSpaces();
		const readonly = {
			...rolePermissions("readonly"),
			scope: "spaces" as const,
			space_ids: [space.id],
		};
		expect(
			await model.create({
				name: "Reader",
				role: "readonly",
				expires_at: null,
				permissions: readonly,
			}),
		).toBe("once");
		expect(request).toHaveBeenCalledWith("/keys", {
			method: "POST",
			json: {
				name: "Reader",
				role: "readonly",
				expires_at: null,
				scope: "spaces",
				space_ids: [space.id],
			},
		});
		expect(
			await model.update("readonly", {
				role: "readonly",
				expires_at: null,
				permissions: { ...readonly, scope: "own", space_ids: [] },
			}),
		).toBe(false);
		expect(model.state.fieldErrors.scope).toBeTruthy();
	});
	it("rejects the exact old slug-as-id custom payload before submitting, then sends picked ids", async () => {
		const request = vi.fn().mockResolvedValue({ items: [space], plaintext: "one-time" });
		const model = new KeysModel({ request });
		await model.loadSpaces();
		expect(model.state.spaces).toEqual([space]);
		expect(
			await model.create({ ...draft, permissions: { ...permissions, space_ids: [space.slug] } }),
		).toBeNull();
		expect(model.state.fieldErrors.space_ids).toBeTruthy();
		expect(request).toHaveBeenCalledTimes(1);
		expect(await model.create(draft)).toBe("one-time");
		expect(request).toHaveBeenCalledWith("/keys", {
			method: "POST",
			json: {
				name: "Research agent",
				role: "custom",
				expires_at: null,
				ops: "r,w",
				scope: "spaces",
				space_ids: [space.id],
				own_entries_only: false,
				auto_own_space: false,
			},
		});
		expect(model.state.fieldErrors).toEqual({});
		expect(JSON.stringify(model.state)).not.toContain("one-time");
	});
	it("sends create/edit project templates and validates the immutable editing name", async () => {
		const request = vi.fn().mockResolvedValue({ items: [], plaintext: "one-time" });
		const model = new KeysModel({ request });
		expect(await model.create({ name: "project-key", role: "project", expires_at: null })).toBe(
			"one-time",
		);
		expect(
			await model.update("project", {
				name: "project-key",
				role: "project",
				expires_at: "2027-01-01T00:00:00.000Z",
			}),
		).toBe(true);
		expect(request).toHaveBeenCalledWith("/keys/project", {
			method: "PATCH",
			json: { role: "project", expires_at: "2027-01-01T00:00:00.000Z" },
		});
		expect(
			await model.update("project", { name: "Invalid Name", role: "project", expires_at: null }),
		).toBe(false);
		expect(model.state.fieldErrors.name).toBeTruthy();
	});
	it("reports every client field error rather than only a generic message", async () => {
		const request = vi.fn();
		const model = new KeysModel({ request });
		expect(
			await model.create({
				...draft,
				name: " ",
				expires_at: "2027-02-30T00:00:00Z",
				permissions: rolePermissions("custom"),
			}),
		).toBeNull();
		expect(model.state.fieldErrors).toEqual({
			name: expect.any(String),
			ops: expect.any(String),
			space_ids: expect.any(String),
			expires_at: expect.any(String),
		});
		expect(model.state.error).toBeTruthy();
		expect(request).not.toHaveBeenCalled();
		model.clearFieldError("ops");
		expect(model.state.fieldErrors.ops).toBeUndefined();
		expect(model.state.fieldErrors.name).toBeTruthy();
		model.clearFormErrors();
		expect(model.state.fieldErrors).toEqual({});
		expect(model.state.error).toBeNull();
	});
	it("maps server validation paths to Chinese field errors for create and edit", async () => {
		const request = vi.fn().mockResolvedValue({ items: [space] });
		const model = new KeysModel({ request });
		await model.loadSpaces();
		const error = new ApiError(400, "validation_failed", {
			issues: [{ path: "space_ids.0" }, { path: "expires_at" }, { path: "unknown" }],
		});
		request.mockRejectedValueOnce(error);
		expect(await model.create(draft)).toBeNull();
		expect(model.state.fieldErrors).toEqual({
			space_ids: expect.any(String),
			expires_at: expect.any(String),
		});
		request.mockRejectedValueOnce(error);
		expect(await model.update("custom", draft)).toBe(false);
		expect(model.state.fieldErrors.space_ids).toBeTruthy();
		request.mockRejectedValueOnce(new ApiError(409, "version_conflict"));
		expect(await model.update("custom", draft)).toBe(false);
		expect(model.state.fieldErrors).toEqual({});
		expect(model.state.error).toContain("刷新");
	});
	it("loads spaces separately, permits retry, and ignores stale and disposed responses", async () => {
		let resolve: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error("private"))
			.mockResolvedValue({ items: [space] });
		const model = new KeysModel({ request });
		await model.loadSpaces();
		expect(model.state).toMatchObject({
			spacesLoaded: false,
			spacesLoading: false,
			spacesError: expect.any(String),
		});
		await model.loadSpaces();
		expect(model.state).toMatchObject({
			spacesLoaded: true,
			spacesLoading: false,
			spacesError: null,
		});
		request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const stale = model.loadSpaces();
		await model.loadSpaces();
		resolve({ items: [] });
		await stale;
		expect(model.state.spaces).toEqual([space]);
		request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const late = model.loadSpaces();
		model.dispose();
		resolve({ items: [] });
		await late;
		expect(model.state.spaces).toEqual([space]);
		expect(model.state.spacesLoading).toBe(false);
	});
});
