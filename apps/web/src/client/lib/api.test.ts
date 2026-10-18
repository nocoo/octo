import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, adminApi } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("Access-only admin transport", () => {
	it.each([
		null,
		"private",
		{},
		{ issues: "private" },
		{ issues: [null, "private", {}, { path: 12 }] },
	])("ignores malformed validation details: %j", async (details) => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ error: { code: "validation_failed", details } }, { status: 400 }),
				),
		);
		const error = await adminApi.request("/keys").catch((error: unknown) => error);
		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).details?.issues ?? []).toEqual([]);
		expect(JSON.stringify(error)).not.toContain("private");
	});
	it("retains validation issue paths without retaining upstream messages or values", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json(
					{
						error: {
							code: "validation_failed",
							message: "private value",
							details: {
								issues: [{ path: "space_ids.0", message: "private value" }, { path: "name" }],
								input: "private value",
							},
						},
					},
					{ status: 400 },
				),
			),
		);
		const error = await adminApi
			.request("/keys", { method: "POST", json: {} })
			.catch((error: unknown) => error);
		expect(error).toMatchObject({
			code: "validation_failed",
			details: { issues: [{ path: "space_ids.0" }, { path: "name" }] },
		});
		expect(JSON.stringify(error)).not.toContain("private value");
	});
	it("uses one same-origin fetch and JSON bodies without persistence", async () => {
		const fetcher = vi.fn().mockImplementation(async () => Response.json({ items: [] }));
		vi.stubGlobal("fetch", fetcher);
		expect(await adminApi.request("/memories?limit=10")).toEqual({ items: [] });
		await adminApi.request("/memories/a", {
			method: "PATCH",
			json: { title: "Edited" },
			headers: { "If-Match": '"2"' },
		});
		expect(fetcher).toHaveBeenLastCalledWith(
			"/api/admin/memories/a",
			expect.objectContaining({
				method: "PATCH",
				credentials: "same-origin",
				redirect: "error",
				cache: "no-store",
				body: '{"title":"Edited"}',
			}),
		);
		const headers = fetcher.mock.calls[1]?.[1].headers as Headers;
		expect(headers.get("If-Match")).toBe('"2"');
		expect(headers.get("Content-Type")).toBe("application/json");
	});
	it("sends raw uploads and accepts empty responses", async () => {
		const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetcher);
		const body = new Blob(["document"]);
		const signal = new AbortController().signal;
		expect(
			await adminApi.request("/memories/a/attachments", { method: "POST", body, signal }),
		).toBeUndefined();
		expect(fetcher).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ body, signal }),
		);
	});
	it.each([
		"https://evil.test",
		"//evil.test",
		"/../v1/keys",
		"/%2e%2e/v1",
		"/a\\b",
		"/a#secret",
		"/a%5cb",
		"/tags/%2e%2e/%2e%2e/%2e%2e/v1",
	])("rejects path escape %s before sending", async (path) => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		await expect(adminApi.request(path)).rejects.toThrow("Invalid admin path");
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("preserves encoded tag names without leaving the admin namespace", async () => {
		const fetcher = vi.fn().mockImplementation(async () => Response.json({ ok: true }));
		vi.stubGlobal("fetch", fetcher);
		await adminApi.request("/tags/a%2Fb/rename", { method: "POST", json: { name: "c" } });
		expect(fetcher).toHaveBeenCalledWith("/api/admin/tags/a%2Fb/rename", expect.any(Object));
		await adminApi.request("/tags/release%2Ev2/rename");
		expect(fetcher).toHaveBeenLastCalledWith(
			"/api/admin/tags/release%2Ev2/rename",
			expect.any(Object),
		);
	});
	it("exposes status/code without raw error text or request secrets", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json(
						{ error: { code: "version_conflict", message: "sensitive upstream text" } },
						{ status: 409 },
					),
				),
		);
		await expect(adminApi.request("/memories/a")).rejects.toMatchObject({
			status: 409,
			code: "version_conflict",
			message: "version_conflict",
		});
	});
	it("handles non-json Access rejection and malformed errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(new Response("Access login", { status: 403 }))
				.mockResolvedValueOnce(Response.json({}, { status: 500 }))
				.mockResolvedValueOnce(new Response("<html>login</html>")),
		);
		await expect(adminApi.request("/whoami")).rejects.toMatchObject({
			status: 403,
			code: "access_denied",
		});
		await expect(adminApi.request("/whoami")).rejects.toMatchObject({
			status: 500,
			code: "request_failed",
		});
		await expect(adminApi.request("/whoami")).rejects.toBeInstanceOf(ApiError);
	});
});
