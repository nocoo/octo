import { expect, test } from "./fixtures";

for (const width of [390, 1440]) {
	test(`chapter links preserve history, fragment restoration and editor protection at ${width}px`, async ({
		page,
		admin,
	}) => {
		const memory = await admin.memory(
			`# Start\n\n${"Context paragraph.\n\n".repeat(60)}## 中文章节\n\n[Start](#heading-start)\n`,
		);
		await page.setViewportSize({ width, height: 800 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`/memories?spaces=${memory.space}&limit=50`);
		await expect.poll(() => page.evaluate(() => history.scrollRestoration)).toBe("manual");
		await page.locator(`[data-memory-link="${memory.id}"]`).click();
		if (width < 768) await page.getByRole("button", { name: "本页目录", exact: true }).click();
		const contents = width < 768 ? page.getByRole("dialog") : page.locator(".octo-memory-toc");
		await contents.getByRole("link", { name: "中文章节", exact: true }).click();
		await expect(page).toHaveURL(/#heading-%E4%B8%AD%E6%96%87%E7%AB%A0%E8%8A%82$/);
		expect(await page.evaluate(() => history.state?.idx)).toBe(2);
		const destination = page.getByRole("heading", { name: "中文章节", exact: true });
		await expect(destination).toBeInViewport({ ratio: 1 });
		await page.locator("#heading-start").evaluate((heading) => heading.scrollIntoView());
		await expect(destination).not.toBeInViewport();
		if (width < 768) await page.getByRole("button", { name: "本页目录", exact: true }).click();
		await contents.getByRole("link", { name: "中文章节", exact: true }).click();
		await expect(destination).toBeInViewport({ ratio: 1 });
		expect(await page.evaluate(() => history.state?.idx)).toBe(2);
		await page.reload();
		await expect(destination).toBeInViewport({ ratio: 1 });
		await page.getByRole("link", { name: "编辑记忆", exact: true }).click();
		await page.getByLabel("标题", { exact: true }).fill("Unsaved after chapter navigation");
		await page.getByRole("button", { name: "返回上一页", exact: true }).click();
		const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
		await expect(confirmation).toBeVisible();
		await confirmation.getByRole("button", { name: "继续编辑", exact: true }).click();
		await expect(page).toHaveURL(/\/edit$/);
		await page.getByRole("button", { name: "返回上一页", exact: true }).click();
		await confirmation.getByRole("button", { name: "放弃修改", exact: true }).click();
		await expect(page).toHaveURL(/#heading-%E4%B8%AD%E6%96%87%E7%AB%A0%E8%8A%82$/);
		await expect(destination).toBeInViewport({ ratio: 1 });
		await page.goForward();
		await expect(page).toHaveURL(/\/edit$/);
		await page.goBack();
		await expect(destination).toBeInViewport({ ratio: 1 });
		await page.locator(".octo-markdown").getByRole("link", { name: "Start", exact: true }).click();
		await expect(page).toHaveURL(/#heading-start$/);
		await expect(page.getByRole("heading", { name: "Start", exact: true })).toBeInViewport({
			ratio: 1,
		});
		expect(await page.evaluate(() => history.state?.idx)).toBe(3);
		await page.goBack();
		await expect(destination).toBeInViewport({ ratio: 1 });
		await page.goBack();
		await page.goBack();
		await expect(page).toHaveURL(new RegExp(`spaces=${memory.space}&limit=50$`));
	});
}

test("retains filter and view URLs through details, browser history and reload", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	const library = `/memories?spaces=${memory.space}&view=list&limit=50`;
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(library);
	await expect(page.getByRole("form", { name: "记忆筛选" })).toBeVisible();
	await page.locator(`[data-memory-link="${memory.id}"]`).click();
	await expect(page).toHaveURL(new RegExp(`/memories/${memory.id}$`));
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
	await page.getByRole("button", { name: "返回上一页", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${library.replaceAll("?", "\\?")}$`));
	await expect(page.getByLabel("空间", { exact: true })).toHaveValue(memory.space);
	await page.goForward();
	await expect(page).toHaveURL(new RegExp(`/memories/${memory.id}$`));
	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(memory.title);
	await page.goBack();
	await expect(page.locator(`[data-memory-link="${memory.id}"]`)).toBeVisible();
});

test("keyboard skip navigation retains history and unsaved editor protection", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.goto(`/memories?spaces=${memory.space}&limit=50`);
	await page.locator(`[data-memory-link="${memory.id}"]`).click();
	const before = await page.evaluate(() => history.state);
	await page.getByRole("link", { name: "跳到主内容", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("main")).toBeFocused();
	expect(await page.evaluate(() => history.state)).toEqual(before);
	await page.getByRole("link", { name: "编辑记忆", exact: true }).click();
	await page.getByLabel("标题", { exact: true }).fill("Unsaved after skip navigation");
	await page.getByRole("button", { name: "返回上一页", exact: true }).click();
	await expect(page.getByRole("alertdialog", { name: "放弃未保存的修改？" })).toBeVisible();
});

test("direct-entry back uses a real parent and embedding breadcrumbs reflect nesting", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.goto(`/memories/${memory.id}/history`);
	await page.getByRole("button", { name: "返回上一页", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/memories/${memory.id}$`));
	await page.getByRole("button", { name: "返回上一页", exact: true }).click();
	await expect(page).toHaveURL(/\/memories$/);
	await page.getByRole("button", { name: "返回上一页", exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
	await page.goto("/settings/embedding");
	const header = page.locator("[data-basalt-header]");
	await expect(header.getByRole("link", { name: "设置", exact: true })).toHaveAttribute(
		"href",
		"/settings",
	);
	await header.getByRole("link", { name: "设置", exact: true }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/settings\/embedding$/);
});

test("header back obeys the unsaved editor guard", async ({ page, admin }) => {
	const memory = await admin.memory();
	await page.goto(`/memories/${memory.id}/edit`);
	await page.getByLabel("标题", { exact: true }).fill("Unsaved navigation check");
	await page.getByRole("button", { name: "返回上一页", exact: true }).click();
	const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole("button", { name: "继续编辑", exact: true }).click();
	await expect(page).toHaveURL(/\/edit$/);
	await expect(page.getByLabel("标题", { exact: true })).toHaveValue("Unsaved navigation check");
	await page.getByRole("button", { name: "返回上一页", exact: true }).click();
	await confirmation.getByRole("button", { name: "放弃修改", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/memories/${memory.id}$`));
});

test("history restores the active filter panel without losing the result view", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.goto("/memories?view=cards");
	const trigger = page.getByRole("button", { name: "展开或收起记忆筛选" });
	await trigger.click();
	await page.getByLabel("空间", { exact: true }).fill(memory.space);
	await page.getByRole("button", { name: "应用筛选", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`spaces=${memory.space}`));
	await trigger.click();
	await expect(page.getByRole("form", { name: "记忆筛选" })).not.toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\/memories\?view=cards$/);
	await page.goForward();
	await expect(page.getByRole("form", { name: "记忆筛选" })).toBeVisible();
	await expect(page.getByLabel("空间", { exact: true })).toHaveValue(memory.space);
	await expect(page.getByRole("heading", { name: "记忆卡片", exact: true })).toBeVisible();
});
