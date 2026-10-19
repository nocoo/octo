import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("revokes, cancels irreversible deletion, retries an error and removes the key", async ({
	page,
	admin,
}) => {
	const name = `l3-delete-${randomUUID()}`;
	const expiredName = `l3-expired-${randomUUID()}`;
	const { key } = await admin.json<{ key: { id: string } }>("/keys", "POST", {
		name,
		role: "readonly",
	});
	await admin.json("/keys", "POST", {
		name: expiredName,
		role: "readonly",
		expires_at: "2000-01-01T00:00:00.000Z",
	});
	await page.goto("/keys");
	const row = page.getByRole("row").filter({ hasText: name });
	const expiredRow = page.getByRole("row").filter({ hasText: expiredName });
	await expect(row).toContainText("有效");
	await expect(row.getByRole("button", { name: `永久删除 ${name}`, exact: true })).toHaveCount(0);
	await expect(expiredRow).toContainText("已过期");
	await expect(
		expiredRow.getByRole("button", { name: `永久删除 ${expiredName}`, exact: true }),
	).toHaveCount(0);
	await row.getByRole("button", { name: `撤销 ${name}`, exact: true }).click();
	await page
		.getByRole("alertdialog", { name: `撤销 ${name}？`, exact: true })
		.getByRole("button", { name: "撤销密钥", exact: true })
		.click();
	await expect(row).toContainText("已撤销");
	for (const action of ["编辑", "轮换", "撤销"])
		await expect(row.getByRole("button", { name: `${action} ${name}`, exact: true })).toHaveCount(
			0,
		);
	const deleteButton = row.getByRole("button", { name: `永久删除 ${name}`, exact: true });
	await deleteButton.click();
	const confirmation = page.getByRole("alertdialog", { name: `永久删除 ${name}？`, exact: true });
	await expect(confirmation).toContainText("无法恢复");
	await expect(confirmation).toContainText("审计记录将保留");
	await confirmation.getByRole("button", { name: "取消", exact: true }).click();
	await expect(confirmation).not.toBeVisible();
	await expect(row).toBeVisible();
	await expect(deleteButton).toBeFocused();
	expect((await admin.response(`/keys/${key.id}`)).status()).toBe(200);
	let attempts = 0;
	await page.route(`**/api/admin/keys/${key.id}`, async (route) => {
		if (route.request().method() === "DELETE" && attempts++ === 0) {
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({
					error: { code: "unavailable", message: "local retry fixture", request_id: randomUUID() },
				}),
			});
		} else await route.continue();
	});
	await deleteButton.click();
	await confirmation.getByRole("button", { name: "永久删除", exact: true }).click();
	await expect(confirmation.getByRole("alert")).toContainText("服务暂时不可用，请稍后重试。");
	await expect(
		page.getByRole("row", { includeHidden: true }).filter({ hasText: name }),
	).toBeAttached();
	expect((await admin.response(`/keys/${key.id}`)).status()).toBe(200);
	const deleted = page.waitForResponse(
		(response) =>
			response.request().method() === "DELETE" &&
			response.url().endsWith(`/api/admin/keys/${key.id}`),
	);
	await confirmation.getByRole("button", { name: "永久删除", exact: true }).click();
	expect((await deleted).status()).toBe(200);
	await expect(confirmation).not.toBeVisible();
	await expect(row).toHaveCount(0);
	await expect(page.getByRole("button", { name: "创建密钥", exact: true }).first()).toBeFocused();
	expect((await admin.response(`/keys/${key.id}`)).status()).toBe(404);
	const list = await admin.json<{ items: { id: string }[] }>("/keys");
	expect(list.items.some((item) => item.id === key.id)).toBe(false);
	expect(attempts).toBe(2);
});
