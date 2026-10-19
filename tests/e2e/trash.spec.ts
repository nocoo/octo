import type { Page } from "@playwright/test";
import { capture, expect, test } from "./fixtures";

async function moveToTrash(page: Page, title: string): Promise<void> {
	await page.goto("/memories");
	const row = page
		.getByRole("row")
		.filter({ has: page.getByRole("link", { name: title, exact: true }) });
	const checkbox = row.getByRole("checkbox");
	await checkbox.click();
	await expect(checkbox).toBeChecked();
	await page.getByRole("button", { name: "移入回收站", exact: true }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "移入回收站", exact: true })
		.click();
	await expect(row).toHaveCount(0);
}

test("delete, restore, then title-check and confirm permanent deletion", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory();
	const endpoint = `/memories/${encodeURIComponent(memory.id)}`;
	await moveToTrash(page, memory.title);
	expect((await admin.response(endpoint)).status()).toBe(404);
	await page.goto("/trash");
	const row = page.getByRole("row").filter({ hasText: memory.title });
	await expect(row).toBeVisible();
	const checkbox = row.getByRole("checkbox");
	await checkbox.click();
	await expect(checkbox).toBeChecked();
	await page.getByRole("button", { name: "恢复所选", exact: true }).click();
	await expect(row).toHaveCount(0);
	expect((await admin.response(endpoint)).status()).toBe(200);
	await page.goto(endpoint);
	await expect(page.getByRole("heading", { name: memory.title, exact: true })).toBeVisible();
	await moveToTrash(page, memory.title);
	await page.goto("/trash");
	await page.getByRole("button", { name: `永久删除 ${memory.title}`, exact: true }).click();
	const titleDialog = page.getByRole("dialog", { name: "输入记忆标题", exact: true });
	await expect(titleDialog.getByRole("button", { name: "继续", exact: true })).toBeDisabled();
	await titleDialog.getByRole("textbox", { name: "确认标题", exact: true }).fill("wrong title");
	await expect(titleDialog.getByRole("button", { name: "继续", exact: true })).toBeDisabled();
	await titleDialog.getByRole("textbox", { name: "确认标题", exact: true }).fill(memory.title);
	await titleDialog.getByRole("button", { name: "继续", exact: true }).click();
	const confirmation = page.getByRole("alertdialog", { name: "确认永久删除？", exact: true });
	await expect(confirmation).toBeVisible();
	const before = await admin.json<{ items: { id: string }[] }>("/trash");
	expect(before.items.some((item) => item.id === memory.id)).toBe(true);
	await capture(page, info, "trash-final-purge-confirmation");
	await confirmation.getByRole("button", { name: "永久删除", exact: true }).click();
	await expect(confirmation).not.toBeVisible();
	await expect(row).toHaveCount(0);
	const after = await admin.json<{ items: { id: string }[] }>("/trash");
	expect(after.items.some((item) => item.id === memory.id)).toBe(false);
	expect((await admin.response(endpoint)).status()).toBe(404);
	expect((await admin.response(`/trash/${memory.id}/restore`, "POST")).status()).toBe(404);
	await page.reload();
	await expect(page.getByRole("row").filter({ hasText: memory.title })).toHaveCount(0);
	await capture(page, info, "trash-purged");
});

test("selects across pages, restores, bulk purges and confirms filtered empty counts", async ({
	page,
	admin,
}, info) => {
	const seed = await admin.memory();
	const prefix = `Bulk trash ${seed.id}`;
	const created = await admin.json<{ results: Array<{ ok: boolean; item: { id: string } }> }>(
		"/memories:batchCreate",
		"POST",
		{
			items: Array.from({ length: 26 }, (_, index) => ({
				space: seed.space,
				title: `${prefix} ${index}`,
				body: "Trash bulk browser fixture",
				type: "note",
				tags: ["trash-bulk"],
			})),
		},
	);
	expect(created.results.every((result) => result.ok)).toBe(true);
	const ids = created.results.map((result) => result.item.id);
	await admin.json("/memories:batchDelete", "POST", { ids });
	await admin.json(`/memories/${seed.id}`, "DELETE");
	await page.goto(`/trash?q=${encodeURIComponent(prefix)}`);
	await expect(page.getByRole("button", { name: "清空回收站（26）", exact: true })).toBeEnabled();
	await page.getByRole("checkbox", { name: "全选当前页", exact: true }).click();
	await expect(page.getByRole("checkbox", { name: "全选当前页", exact: true })).toBeChecked();
	await capture(page, info, "trash-list-selection");
	await page.getByRole("button", { name: "选择全部 26 条", exact: true }).click();
	await expect(page.getByText("已选择 26 条记忆，范围为当前筛选的全部匹配项。")).toBeVisible();
	await capture(page, info, "trash-bulk-bar");
	await page.getByRole("button", { name: "恢复所选", exact: true }).click();
	await expect(page.getByRole("button", { name: "清空回收站（0）", exact: true })).toBeVisible();
	for (const id of ids) expect((await admin.response(`/memories/${id}`)).status()).toBe(200);
	await admin.json("/memories:batchDelete", "POST", { ids });
	await page.reload();
	await expect(page.getByRole("button", { name: "清空回收站（26）", exact: true })).toBeEnabled();
	const choices = page.getByRole("checkbox", { name: /^选择 Bulk trash / });
	await choices.nth(0).click();
	await expect(choices.nth(0)).toBeChecked();
	await choices.nth(1).click();
	await expect(choices.nth(1)).toBeChecked();
	await page.getByRole("button", { name: "彻底删除所选", exact: true }).click();
	const purge = page.getByRole("alertdialog");
	await expect(purge).toContainText("2");
	await capture(page, info, "trash-bulk-purge-confirm");
	await purge.getByRole("button", { name: "确认彻底删除", exact: true }).click();
	await expect(page.getByRole("button", { name: "清空回收站（24）", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "清空回收站（24）", exact: true }).click();
	const empty = page.getByRole("alertdialog");
	await expect(empty).toContainText("24");
	await expect(empty).toContainText(prefix);
	await capture(page, info, "trash-empty-count-confirm");
	await empty.getByRole("button", { name: "确认清空回收站", exact: true }).click();
	await expect(page.getByRole("button", { name: "清空回收站（0）", exact: true })).toBeVisible();
	const remaining = await admin.json<{ items: Array<{ id: string }>; total: number }>(
		`/trash?space=${seed.space}`,
	);
	expect(remaining).toMatchObject({ total: 1, items: [{ id: seed.id }] });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(page.getByRole("heading", { name: "回收站", exact: true })).toBeVisible();
	await capture(page, info, "trash-mobile-empty");
});
