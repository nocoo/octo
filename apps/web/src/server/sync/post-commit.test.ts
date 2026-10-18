import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppVars, Env } from "../env";
import { postCommitMiddleware } from "./post-commit";

describe("post-commit derived work", () => {
	function fixture(fail = false) {
		const events: string[] = [];
		const pending: Promise<unknown>[] = [];
		const process = vi.fn(async () => {
			events.push("derived");
			if (fail) throw new Error("private provider error");
		});
		const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
		app.use("*", postCommitMiddleware(process));
		app.use("*", async (_context, next) => {
			await next();
			events.push("commit");
		});
		app.all("*", (context) => {
			events.push("prepare");
			return context.json({}, context.req.query("fail") ? 503 : 200);
		});
		const ctx = {
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
			passThroughOnException() {},
			props: {},
		} as unknown as ExecutionContext;
		return { events, pending, process, app, ctx };
	}

	it("starts derived work only after the HTTP-owned D1 commit", async () => {
		const { app, ctx, events, pending, process } = fixture();
		const env = {} as Env;
		expect((await app.request("/api/v1/memories", { method: "POST" }, env, ctx)).status).toBe(200);
		await Promise.all(pending);
		expect(events).toEqual(["prepare", "commit", "derived"]);
		expect(process).toHaveBeenCalledWith(env);
	});

	it("awaits derived work inline for the L2 serialized vector sync binding", async () => {
		const { app, ctx, events, pending, process } = fixture();
		const env = { RESOURCE_ENV: "test", OCTO_VECTOR_SYNC_CONCURRENCY: "1" } as Env;
		expect((await app.request("/api/v1/memories", { method: "POST" }, env, ctx)).status).toBe(200);
		expect(pending).toHaveLength(0);
		expect(events).toEqual(["prepare", "commit", "derived"]);
		expect(process).toHaveBeenCalledWith(env);
	});

	it.each([
		["GET", "/api/v1/memories"],
		["POST", "/api/v1/search"],
		["POST", "/api/admin/memories:batchGet"],
		["POST", "/api/admin/settings/embedding/test"],
		["PATCH", "/api/admin/memories/one?fail=yes"],
	])("does not process read-only or failed %s %s", async (method, path) => {
		const { app, ctx, pending, process } = fixture();
		await app.request(path, { method }, {} as Env, ctx);
		expect(pending).toHaveLength(0);
		expect(process).not.toHaveBeenCalled();
	});

	it("isolates failures from the committed response and logs no error body", async () => {
		const { app, ctx, pending } = fixture(true);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(
			(await app.request("/api/v1/memories/one", { method: "DELETE" }, {} as Env, ctx)).status,
		).toBe(200);
		await Promise.all(pending);
		expect(error).toHaveBeenCalledWith("derived_work_failed");
		error.mockRestore();
	});

	it("permits a context-free unit invocation without starting orphan work", async () => {
		const { app, process } = fixture();
		await app.request("/api/v1/memories", { method: "POST" }, {} as Env);
		expect(process).not.toHaveBeenCalled();
	});
});
