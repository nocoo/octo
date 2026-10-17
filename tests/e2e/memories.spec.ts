import { capture, expect, type TestMemory, test } from "./fixtures";

test("search, read, edit, resolve a real stale-version conflict, and rollback", async ({
	page,
	context,
	admin,
}, info) => {
	const memory = await admin.memory();
	const path = `/memories/${encodeURIComponent(memory.id)}`;
	await page.goto("/search");
	await page.getByRole("textbox", { name: "Search memories", exact: true }).fill(memory.title);
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await page.getByRole("link", { name: memory.title, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${path}$`));
	await expect(page.getByRole("heading", { name: memory.title, exact: true })).toBeVisible();
	await expect(page.getByRole("table").filter({ hasText: "Signal" })).toContainText("local");
	await capture(page, info, "memory-reader-desktop");
	await page.getByRole("link", { name: "Edit memory", exact: true }).click();
	const body = page.getByRole("textbox", { name: "Markdown body", exact: true });
	await expect(body).toHaveValue(memory.body);
	const mine = `${memory.body}\nMy local revision.`;
	const theirs = `${memory.body}\nA concurrent revision.`;
	await body.fill(mine);
	const other = await context.newPage();
	try {
		await other.goto(`${path}/edit`);
		await other.getByRole("textbox", { name: "Markdown body", exact: true }).fill(theirs);
		await other.getByRole("button", { name: "Save memory", exact: true }).click();
		await expect(other.getByText("Saved version 2", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Save memory", exact: true }).click();
		const conflict = page.getByRole("dialog", { name: "Resolve version conflict", exact: true });
		await expect(conflict).toBeVisible();
		await expect(conflict).toContainText("My local revision.");
		await expect(conflict).toContainText("A concurrent revision.");
		await expect(conflict.getByRole("button", { name: "Apply merge", exact: true })).toBeDisabled();
		await capture(page, info, "editor-three-way-conflict");
		await conflict.getByRole("button", { name: "Use mine: body", exact: true }).click();
		await conflict.getByRole("button", { name: "Apply merge", exact: true }).click();
		await expect(conflict).not.toBeVisible();
		await page.getByRole("button", { name: "Save memory", exact: true }).click();
		await expect(page.getByText("Saved version 3", { exact: true })).toBeVisible();
		const saved = await admin.json<TestMemory>(`/memories/${memory.id}`);
		expect(saved.body).toBe(mine);
		expect(saved.version).toBe(3);
	} finally {
		await other.close();
	}
	await page.goto(path);
	await page.getByRole("link", { name: "Version history", exact: true }).click();
	await page.goto(`${path}/history?from=1&to=3`);
	await expect(page.getByRole("table", { name: "Body diff", exact: true })).toContainText(
		"My local revision.",
	);
	await page.getByRole("button", { name: "Rollback to version 1", exact: true }).click();
	await page.getByRole("button", { name: "Confirm rollback", exact: true }).click();
	await expect(page.getByText("Rollback created version 4", { exact: true })).toBeVisible();
	const rolledBack = await admin.json<TestMemory>(`/memories/${memory.id}`);
	expect(rolledBack.version).toBe(4);
	expect(rolledBack.body).toBe(memory.body);
	await capture(page, info, "memory-history-rollback");
	await page.goto(path);
	await expect(page.getByText("My local revision.", { exact: true })).toHaveCount(0);
});

test("mobile reader keeps content and TOC usable without horizontal overflow", async ({
	page,
	admin,
}, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const memory = await admin.memory();
	await page.goto(`/memories/${encodeURIComponent(memory.id)}`);
	await expect(page.getByRole("heading", { name: memory.title, exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "On this page", exact: true }).click();
	await expect(page.getByRole("link", { name: "Details", exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Details", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Details", exact: true })).toBeInViewport();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await capture(page, info, "memory-reader-mobile");
});
