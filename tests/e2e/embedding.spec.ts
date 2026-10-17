import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";
import { startGateway } from "./gateway";

test("embedding defaults, write-only masking, real connection test, and clear", async ({
	page,
	admin,
}, info) => {
	const secret = `l3-embedding-${randomUUID()}-abcd`;
	const gateway = await startGateway(secret);
	try {
		await page.goto("/settings/embedding");
		const model = page.getByRole("textbox", { name: "模型", exact: true });
		await expect(model).toHaveValue("text-embedding-3-small");
		await expect(page.getByRole("spinbutton", { name: "维度", exact: true })).toHaveValue("1536");
		await expect(page.getByRole("switch", { name: "回填缺失向量", exact: true })).not.toBeChecked();
		const replacement = page.getByLabel("替换密钥", { exact: true });
		await expect(replacement).toHaveAttribute("type", "password");
		expect((await replacement.inputValue()) === "").toBe(true);
		await page.getByRole("textbox", { name: "网关地址", exact: true }).fill(gateway.url);
		await expect(replacement).toBeEditable();
		await replacement.fill(secret);
		await page.getByRole("button", { name: "保存设置", exact: true }).click();
		await expect(page.getByRole("status").filter({ hasText: "已配置" })).toContainText("abcd");
		expect((await replacement.inputValue()) === "").toBe(true);
		await page.reload();
		await expect(page.getByRole("status").filter({ hasText: "已配置" })).toContainText("abcd");
		expect((await replacement.inputValue()) === "").toBe(true);
		const stored = await admin.response("/settings/embedding");
		const storedText = await stored.text();
		expect(storedText.includes(secret)).toBe(false);
		expect(JSON.parse(storedText)).toMatchObject({
			api_key_set: true,
			api_key_mask: "****abcd",
			backfill_enabled: false,
		});
		expect(
			await page.evaluate(
				(value) =>
					!document.documentElement.outerHTML.includes(value) &&
					!JSON.stringify(localStorage).includes(value) &&
					!JSON.stringify(sessionStorage).includes(value),
				secret,
			),
		).toBe(true);
		const tested = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				response.url().endsWith("/settings/embedding/test"),
		);
		await page.getByRole("button", { name: "测试连接", exact: true }).click();
		expect(await (await tested).json()).toEqual({
			latency_ms: expect.any(Number),
			dims: 1536,
			match: true,
			error_code: null,
		});
		await expect(page.getByText("连接成功", { exact: true })).toBeVisible();
		expect(gateway.observations.length).toBeGreaterThan(0);
		for (const observation of gateway.observations)
			expect(observation).toMatchObject({
				authorized: true,
				userAgent: expect.stringMatching(/^octo\//),
				model: "text-embedding-3-small",
				path: "/v1/embeddings",
			});
		await capture(page, info, "embedding-masked-connection-tested");
		await page.getByRole("button", { name: "清除已保存密钥", exact: true }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "清除密钥", exact: true })
			.click();
		await expect(page.getByText("尚未配置接口密钥", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "清除已保存密钥", exact: true })).toBeDisabled();
		await page.reload();
		expect((await replacement.inputValue()) === "").toBe(true);
		await expect(page.getByText("尚未配置接口密钥", { exact: true })).toBeVisible();
		const cleared = await admin.json<{ api_key_set: boolean; api_key_mask: string | null }>(
			"/settings/embedding",
		);
		expect(cleared).toMatchObject({ api_key_set: false, api_key_mask: null });
		await page.getByRole("button", { name: "测试连接", exact: true }).click();
		await expect(page.getByRole("alert").filter({ hasText: "embedder_unavailable" })).toContainText(
			"嵌入服务暂时不可用。",
		);
		await capture(page, info, "embedding-secret-cleared");
	} finally {
		await gateway.close();
	}
});
