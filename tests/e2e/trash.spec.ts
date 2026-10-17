import type { Page } from "@playwright/test";
import { capture, expect, test } from "./fixtures";

async function moveToTrash(page: Page, title: string): Promise<void> {
	await page.goto("/memories");
	const row = page
		.getByRole("row")
		.filter({ has: page.getByRole("link", { name: title, exact: true }) });
	await row.getByRole("checkbox").check();
	await page.getByRole("button", { name: "Move to trash", exact: true }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Move to trash", exact: true })
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
	await row.getByRole("checkbox").check();
	await page.getByRole("button", { name: "Restore selected (1)", exact: true }).click();
	await expect(row).toHaveCount(0);
	expect((await admin.response(endpoint)).status()).toBe(200);
	await page.goto(endpoint);
	await expect(page.getByRole("heading", { name: memory.title, exact: true })).toBeVisible();
	await moveToTrash(page, memory.title);
	await page.goto("/trash");
	await page
		.getByRole("button", { name: `Permanently delete ${memory.title}`, exact: true })
		.click();
	const titleDialog = page.getByRole("dialog", { name: "Type the memory title", exact: true });
	await expect(titleDialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
	await titleDialog
		.getByRole("textbox", { name: "Confirm title", exact: true })
		.fill("wrong title");
	await expect(titleDialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
	await titleDialog.getByRole("textbox", { name: "Confirm title", exact: true }).fill(memory.title);
	await titleDialog.getByRole("button", { name: "Continue", exact: true }).click();
	const confirmation = page.getByRole("alertdialog", { name: "Delete permanently?", exact: true });
	await expect(confirmation).toBeVisible();
	const before = await admin.json<{ items: { id: string }[] }>("/trash");
	expect(before.items.some((item) => item.id === memory.id)).toBe(true);
	await capture(page, info, "trash-final-purge-confirmation");
	await confirmation.getByRole("button", { name: "Delete permanently", exact: true }).click();
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
