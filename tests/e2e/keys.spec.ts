import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";

test("mint once, copy, close, refresh, and revoke a real API key", async ({
	page,
	context,
	admin,
}, info) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const name = `L3 agent ${randomUUID()}`;
	await page.goto("/keys");
	await page.getByRole("button", { name: "创建密钥", exact: true }).first().click();
	const create = page.getByRole("dialog", { name: "创建接口密钥", exact: true });
	await create.getByRole("textbox", { name: "代理名称", exact: true }).fill(name);
	await create.getByRole("button", { name: "创建密钥", exact: true }).click();
	const reveal = page.getByRole("dialog", { name: "请立即复制密钥", exact: true });
	await expect(reveal).toBeVisible();
	const secret = await reveal.getByRole("textbox", { name: "接口密钥", exact: true }).inputValue();
	expect(secret.startsWith("octo_")).toBe(true);
	try {
		await reveal.getByRole("button", { name: "复制密钥", exact: true }).click();
		expect(
			await page.evaluate(
				async (value) => (await navigator.clipboard.readText()) === value,
				secret,
			),
		).toBe(true);
		await reveal.getByRole("button", { name: "关闭并清除", exact: true }).click();
		await expect(reveal).not.toBeVisible();
		await page.reload();
		await expect(page.getByRole("row").filter({ hasText: name })).toContainText("有效");
		expect(
			await page.evaluate(
				(value) =>
					!document.documentElement.outerHTML.includes(value) &&
					!Array.from(document.querySelectorAll("input")).some((input) =>
						input.value.includes(value),
					) &&
					!JSON.stringify(localStorage).includes(value) &&
					!JSON.stringify(sessionStorage).includes(value),
				secret,
			),
		).toBe(true);
		const listed = await admin.response("/keys");
		expect((await listed.text()).includes(secret)).toBe(false);
		const accepted = await page.request.get("/api/v1/me", {
			headers: { Authorization: `Bearer ${secret}` },
			maxRedirects: 0,
		});
		expect(accepted.status()).toBe(200);
		await page.getByRole("button", { name: `撤销 ${name}`, exact: true }).click();
		await page.getByRole("button", { name: "撤销密钥", exact: true }).click();
		await expect(page.getByRole("row").filter({ hasText: name })).toContainText("已撤销");
		const rejected = await page.request.get("/api/v1/me", {
			headers: { Authorization: `Bearer ${secret}` },
			maxRedirects: 0,
		});
		expect(rejected.status()).toBe(401);
		await capture(page, info, "keys-revoked-secret-cleared");
	} finally {
		await page.evaluate(() => navigator.clipboard.writeText(""));
	}
});
