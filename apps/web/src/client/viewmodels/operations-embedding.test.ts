import { describe, expect, it, vi } from "vitest";
import { EmbeddingModel, embeddingFailureStageLabel, SettingsModel } from "./operations-embedding";

const fields = {
	base_url: "https://gateway.example",
	model: "text-embedding-3-small",
	dims: 1536,
	backfill_enabled: false,
};
const saved = { ...fields, api_key_set: true, api_key_mask: "****abcd" };

describe("embedding settings", () => {
	it("normalizes the nullable wire address for a controlled form", async () => {
		const request = vi.fn().mockResolvedValue({ ...saved, base_url: null });
		const model = new EmbeddingModel({ request });
		await model.load();
		expect(model.state.config.base_url).toBe("");
		expect(model.state.config.api_key_set).toBe(true);
	});

	it("clears only the saved key even without a configured gateway", async () => {
		const request = vi.fn().mockResolvedValue({ ...saved, base_url: null });
		const model = new EmbeddingModel({ request });
		expect(await model.clearKey()).toBe(false);
		expect(request).not.toHaveBeenCalled();
		await model.load();
		request.mockResolvedValue({ ...saved, base_url: null, api_key_set: false, api_key_mask: null });
		expect(await model.clearKey()).toBe(true);
		expect(request).toHaveBeenCalledWith("/settings/embedding", {
			method: "PUT",
			json: { api_key: null },
		});
		expect(model.state.config).toMatchObject({
			base_url: "",
			api_key_set: false,
			api_key_mask: null,
		});
		model.dispose();
		expect(await model.clearKey()).toBe(false);
	});

	it("keeps configuration unknown after an initial read failure and blocks changes without hiding the error", async () => {
		const request = vi.fn().mockRejectedValue(new Error("private"));
		const model = new EmbeddingModel({ request });
		expect(model.state.loaded).toBe(false);
		expect(await model.save(fields, "replacement")).toBe(false);
		await model.test(fields);
		expect(request).not.toHaveBeenCalled();
		await model.load();
		expect(model.state.loaded).toBe(false);
		expect(model.state.error).toBe("无法加载嵌入设置。");
		expect(await model.save(fields, null)).toBe(false);
		await model.test(fields);
		expect(request).toHaveBeenCalledTimes(1);
		expect(model.state.error).toBe("无法加载嵌入设置。");
	});

	it("only marks successful reads loaded and retains stale configuration on refresh failure", async () => {
		const config = { ...saved, backfill_enabled: true, model: "active-model", dims: 512 };
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error("private"))
			.mockResolvedValueOnce(config)
			.mockRejectedValueOnce(new Error("private"));
		const model = new EmbeddingModel({ request });
		await model.load();
		expect(model.state.loaded).toBe(false);
		await model.load();
		expect(model.state.loaded).toBe(true);
		expect(model.state.config).toEqual(config);
		await model.load();
		expect(model.state.loaded).toBe(true);
		expect(model.state.config).toEqual(config);
		expect(model.state.error).toBe("无法加载嵌入设置。");
	});

	it("shows cleared credentials and ignores disposed read failures", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ ...saved, api_key_set: false, api_key_mask: null });
		const model = new EmbeddingModel({ request });
		await model.load();
		expect(model.state.config.api_key_mask).toBeNull();
		let reject: (reason: Error) => void = () => {};
		request.mockImplementationOnce(
			() =>
				new Promise((_, fail) => {
					reject = fail;
				}),
		);
		const loading = model.load();
		model.dispose();
		reject(new Error("secret"));
		await loading;
		expect(model.state.error).toBeNull();
	});

	it("drops disposed save/test results and failures without retaining submitted credentials", async () => {
		for (const action of ["save", "test"] as const) {
			for (const fail of [false, true]) {
				let resolve: (value: unknown) => void = () => {};
				let reject: (reason: Error) => void = () => {};
				const request = vi
					.fn()
					.mockResolvedValueOnce(saved)
					.mockImplementation(
						() =>
							new Promise((done, failed) => {
								resolve = done;
								reject = failed;
							}),
					);
				const model = new EmbeddingModel({ request });
				await model.load();
				const pending = model[action](fields, "secret");
				model.dispose();
				if (fail) reject(new Error("secret"));
				else resolve({ latency_ms: 1, dims: 1536, match: true, error_code: null, reason: null });
				await pending;
				expect(model.state).toMatchObject({ error: null, pending: false, testResult: null });
				expect(JSON.stringify(model.state)).not.toContain("secret");
			}
		}
	});
	it("starts with the documented defaults and projects only readable fields", async () => {
		const request = vi.fn().mockResolvedValue({ ...saved, api_key: "never-read" });
		const model = new EmbeddingModel({ request });
		expect(model.state.loaded).toBe(false);
		expect(model.state.config).toEqual({
			...fields,
			base_url: "",
			api_key_set: false,
			api_key_mask: null,
		});
		await model.load();
		expect(model.state.loaded).toBe(true);
		expect(request).toHaveBeenCalledWith("/settings/embedding");
		expect(model.state.config).toEqual(saved);
		expect(JSON.stringify(model.state)).not.toContain("never-read");
	});

	it("writes a replacement once, clears explicitly, and omits unchanged credentials", async () => {
		const request = vi.fn().mockResolvedValue(saved);
		const model = new EmbeddingModel({ request });
		await model.load();
		expect(await model.save(fields, "new-secret")).toBe(true);
		expect(request).toHaveBeenCalledWith("/settings/embedding", {
			method: "PUT",
			json: { ...fields, api_key: "new-secret" },
		});
		expect(JSON.stringify(model.state)).not.toContain("new-secret");
		await model.save(fields, null);
		expect(request).toHaveBeenCalledWith("/settings/embedding", {
			method: "PUT",
			json: { ...fields, api_key: null },
		});
		await model.save(fields);
		expect(request).toHaveBeenLastCalledWith("/settings/embedding");
		expect(request.mock.calls.at(-2)).toEqual([
			"/settings/embedding",
			{ method: "PUT", json: fields },
		]);
	});

	it("validates URLs, model, dimensions and replacement before any request", async () => {
		const request = vi.fn().mockResolvedValue(saved);
		const model = new EmbeddingModel({ request });
		await model.load();
		request.mockClear();
		for (const base_url of [
			"bad",
			"javascript:alert(1)",
			"https://user:pass@host",
			"https://host/#fragment",
			"https://host/?key=x",
		])
			expect(await model.save({ ...fields, base_url })).toBe(false);
		for (const dims of [0, 1537, 1.5, Number.NaN])
			expect(await model.save({ ...fields, dims })).toBe(false);
		expect(await model.save({ ...fields, model: " " })).toBe(false);
		expect(await model.save(fields, " ")).toBe(false);
		expect(request).not.toHaveBeenCalled();
	});

	it("tests an unsaved config and reports latency, dimensions, mismatch and sanitized errors", async () => {
		const result = {
			latency_ms: 23,
			dims: 3,
			match: false,
			error_code: "vector_dimension_mismatch" as const,
			reason: { stage: "dims" as const },
		};
		const request = vi
			.fn()
			.mockResolvedValueOnce(saved)
			.mockResolvedValueOnce({ ...result, api_key: "leak", upstream_error: "leak" });
		const model = new EmbeddingModel({ request });
		await model.load();
		await model.test(fields, "test-secret");
		expect(request).toHaveBeenCalledWith("/settings/embedding/test", {
			method: "POST",
			json: { ...fields, api_key: "test-secret" },
		});
		expect(model.state.testResult).toEqual(result);
		expect(JSON.stringify(model.state)).not.toContain("leak");
		request.mockResolvedValueOnce({
			latency_ms: 12,
			dims: 1536,
			match: true,
			error_code: null,
			reason: null,
		});
		await model.test(fields);
		expect(model.state.testResult?.match).toBe(true);
		expect(model.state.testResult?.reason).toBeNull();
		request.mockRejectedValueOnce(new Error("test-secret"));
		await model.test(fields, null);
		expect(model.state.error).toBe("无法测试嵌入连接。");
		expect(model.state.testResult).toBeNull();
		await model.test({ ...fields, dims: -1 });
	});

	it("requires a structured reason and keeps only stage plus numeric upstream status", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(saved)
			.mockResolvedValueOnce({
				latency_ms: 9,
				dims: null,
				match: false,
				error_code: "embedder_unavailable",
				reason: {
					stage: "status",
					upstream_status: 401,
					body: "private-upstream-body",
					url: "https://gateway.example/secret",
					host: "gateway.example",
					api_key: "secret-key",
				},
			});
		const model = new EmbeddingModel({ request });
		await model.load();
		await model.test(fields);
		expect(model.state.testResult).toEqual({
			latency_ms: 9,
			dims: null,
			match: false,
			error_code: "embedder_unavailable",
			reason: { stage: "status", upstream_status: 401 },
		});
		expect(JSON.stringify(model.state.testResult)).not.toMatch(
			/private-upstream|secret-key|gateway\.example|\/secret/,
		);
	});

	it("rejects missing, undocumented or mismatched reason payloads", async () => {
		const request = vi.fn().mockResolvedValue(saved);
		const model = new EmbeddingModel({ request });
		await model.load();
		for (const payload of [
			{
				latency_ms: 1,
				dims: null,
				match: false,
				error_code: "embedder_unavailable",
			},
			{
				latency_ms: 1,
				dims: null,
				match: false,
				error_code: "embedder_unavailable",
				reason: { stage: "upstream-secret" },
			},
			{
				latency_ms: 1,
				dims: 1536,
				match: true,
				error_code: null,
				reason: { stage: "config" },
			},
			{
				latency_ms: 1,
				dims: null,
				match: false,
				error_code: "embedder_unavailable",
				reason: { stage: "status", upstream_status: 12.5 },
			},
		]) {
			request.mockResolvedValueOnce(payload);
			await model.test(fields);
			expect(model.state.testResult).toBeNull();
			expect(model.state.error).toBe("无法测试嵌入连接。");
		}
		expect(JSON.stringify(model.state)).not.toMatch(/upstream-secret|12\.5/);
	});

	it("rejects undocumented diagnostics rather than retaining or displaying them", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(saved)
			.mockResolvedValueOnce({
				latency_ms: 1,
				dims: null,
				match: false,
				error_code: "upstream-secret-response",
				reason: { stage: "status", upstream_status: 500 },
				upstream_error: "private",
			});
		const model = new EmbeddingModel({ request });
		await model.load();
		await model.test(fields);
		expect(model.state.testResult).toBeNull();
		expect(model.state.error).toBe("无法测试嵌入连接。");
		expect(JSON.stringify(model.state)).not.toMatch(/upstream|private/);
	});

	it("handles load/save failures, retains prior data and ignores stale responses", async () => {
		let finish: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockResolvedValueOnce(saved)
			.mockRejectedValueOnce(new Error("private"));
		const model = new EmbeddingModel({ request });
		await model.load();
		await model.load();
		expect(model.state.config).toEqual(saved);
		expect(model.state.error).toBe("无法加载嵌入设置。");
		request.mockRejectedValueOnce(new Error("private"));
		expect(await model.save(fields, "secret")).toBe(false);
		expect(model.state.error).toBe("无法保存嵌入设置。");
		request
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValueOnce(saved);
		const pending = model.load();
		await model.load();
		finish({ ...saved, model: "stale" });
		await pending;
		expect(model.state.config.model).toBe(fields.model);
	});

	it("locks writes during save/test, and disposal prevents late updates", async () => {
		let finish: (value: unknown) => void = () => {};
		const request = vi
			.fn()
			.mockResolvedValueOnce(saved)
			.mockImplementation(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			);
		const model = new EmbeddingModel({ request });
		await model.load();
		request.mockClear();
		const pending = model.test(fields);
		expect(await model.save(fields)).toBe(false);
		await model.test(fields);
		expect(request).toHaveBeenCalledTimes(1);
		model.dispose();
		finish({ latency_ms: 1, dims: 1, match: false, error_code: null, reason: null });
		await pending;
		expect(model.state.testResult).toBeNull();
		expect(model.state.pending).toBe(false);
	});

	it("exposes Chinese labels for every documented failure stage", () => {
		expect(embeddingFailureStageLabel("config")).toBe("配置不完整");
		expect(embeddingFailureStageLabel("decrypt")).toBe("密钥解密失败");
		expect(embeddingFailureStageLabel("request")).toBe("网关请求失败");
		expect(embeddingFailureStageLabel("status")).toBe("上游状态异常");
		expect(embeddingFailureStageLabel("redirect")).toBe("上游重定向被拒绝");
		expect(embeddingFailureStageLabel("timeout")).toBe("网关请求超时");
		expect(embeddingFailureStageLabel("parse")).toBe("上游响应解析失败");
		expect(embeddingFailureStageLabel("dims")).toBe("向量维度不匹配");
	});
});

describe("embedding profiles settings", () => {
	it("does not certify an unknown profiles list, including after a failed initial read", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error("private"))
			.mockResolvedValueOnce({ items: [] });
		const model = new SettingsModel({ request });
		expect(model.state).toMatchObject({ loaded: false });
		await model.load();
		expect(model.state).toMatchObject({
			loaded: false,
			error: "无法加载嵌入配置。",
		});
		await model.load();
		expect(model.state).toMatchObject({ loaded: true, profiles: [], error: null });
	});
	it("ignores stale profile reads and failures after disposal", async () => {
		for (const fail of [false, true]) {
			let resolve: (value: unknown) => void = () => {};
			let reject: (reason: Error) => void = () => {};
			const request = vi.fn().mockImplementationOnce(
				() =>
					new Promise((done, failed) => {
						resolve = done;
						reject = failed;
					}),
			);
			const model = new SettingsModel({ request });
			const pending = model.load();
			model.dispose();
			if (fail) reject(new Error("private"));
			else resolve({ items: [{ id: "stale" }] });
			await pending;
			expect(model.state.profiles).toEqual([]);
			expect(model.state.error).toBeNull();
		}
	});
	it("loads profiles and exposes errors and retries without dropping old data", async () => {
		const items = [
			{
				id: "p",
				model: "text-embedding-3-small",
				dims: 1536,
				metric: "cosine",
				active: true,
				created_at: "2026-10-01T00:00:00.000Z",
			},
		];
		const request = vi
			.fn()
			.mockResolvedValueOnce({ items, active_profile: "p", next_cursor: null })
			.mockRejectedValueOnce(new Error("secret"))
			.mockResolvedValueOnce({ items: [] });
		const model = new SettingsModel({ request });
		await model.load();
		expect(request).toHaveBeenCalledWith("/embedding-profiles");
		expect(model.state.profiles).toEqual(items);
		expect(model.state.activeProfile).toBe("p");
		await model.load();
		expect(model.state.profiles).toEqual(items);
		expect(model.state.error).toBe("无法加载嵌入配置。");
		await model.load();
		expect(model.state).toMatchObject({ profiles: [], error: null, loading: false });
	});
});
