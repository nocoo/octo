import { capture, expect, type TestMemory, test } from "./fixtures";

test("search, read, edit, resolve a real stale-version conflict, and rollback", async ({
	page,
	context,
	admin,
}, info) => {
	const memory = await admin.memory();
	const path = `/memories/${encodeURIComponent(memory.id)}`;
	await page.goto("/search");
	await page.getByRole("textbox", { name: "搜索记忆", exact: true }).fill(memory.title);
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	await page.getByRole("link", { name: memory.title, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${path}$`));
	await expect(page.getByRole("heading", { name: memory.title, exact: true })).toBeVisible();
	await expect(page.getByRole("table").filter({ hasText: "Signal" })).toContainText("local");
	await capture(page, info, "memory-reader-desktop");
	await page.getByRole("link", { name: "编辑记忆", exact: true }).click();
	const body = page.getByRole("textbox", { name: "Markdown 正文", exact: true });
	await expect(body).toHaveValue(memory.body);
	const mine = `${memory.body}\nMy local revision.`;
	const theirs = `${memory.body}\nA concurrent revision.`;
	await body.fill(mine);
	const other = await context.newPage();
	try {
		await other.goto(`${path}/edit`);
		await other.getByRole("textbox", { name: "Markdown 正文", exact: true }).fill(theirs);
		await other.getByRole("button", { name: "保存记忆", exact: true }).click();
		await expect(other.getByText("已保存第 2 版", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "保存记忆", exact: true }).click();
		const conflict = page.getByRole("dialog", { name: "解决版本冲突", exact: true });
		await expect(conflict).toBeVisible();
		await expect(conflict).toContainText("My local revision.");
		await expect(conflict).toContainText("A concurrent revision.");
		await expect(conflict.getByRole("button", { name: "应用合并", exact: true })).toBeDisabled();
		await capture(page, info, "editor-three-way-conflict");
		await conflict.getByRole("button", { name: "使用我的修改：正文", exact: true }).click();
		await conflict.getByRole("button", { name: "应用合并", exact: true }).click();
		await expect(conflict).not.toBeVisible();
		await page.getByRole("button", { name: "保存记忆", exact: true }).click();
		await expect(page.getByText("已保存第 3 版", { exact: true })).toBeVisible();
		const saved = await admin.json<TestMemory>(`/memories/${memory.id}`);
		expect(saved.body).toBe(mine);
		expect(saved.version).toBe(3);
	} finally {
		await other.close();
	}
	await page.goto(path);
	await page.getByRole("link", { name: "版本历史", exact: true }).click();
	await page.goto(`${path}/history?from=1&to=3`);
	await expect(page.getByRole("table", { name: "正文差异", exact: true })).toContainText(
		"My local revision.",
	);
	await page.getByRole("button", { name: "回滚到第 1 版", exact: true }).click();
	await page.getByRole("button", { name: "确认回滚", exact: true }).click();
	await expect(page.getByText("回滚已生成第 4 版", { exact: true })).toBeVisible();
	const rolledBack = await admin.json<TestMemory>(`/memories/${memory.id}`);
	expect(rolledBack.version).toBe(4);
	expect(rolledBack.body).toBe(memory.body);
	await capture(page, info, "memory-history-rollback");
	await page.goto(path);
	await expect(page.getByText("My local revision.", { exact: true })).toHaveCount(0);
});

for (const navigation of [
	"Read memory link",
	"sidebar",
	"command palette",
	"browser Back",
] as const) {
	test(`dirty editor guards ${navigation} without saving the draft`, async ({ page, admin }) => {
		const memory = await admin.memory();
		const path = `/memories/${encodeURIComponent(memory.id)}`;
		await page.goto(path);
		await page.getByRole("link", { name: "编辑记忆", exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`${path}/edit$`));
		const editURL = page.url();
		const body = page.getByRole("textbox", { name: "Markdown 正文", exact: true });
		await expect(body).toHaveValue(memory.body);
		const draft = `${memory.body}\nAn unsaved navigation draft.`;
		await body.fill(draft);
		async function leaveEditor() {
			switch (navigation) {
				case "Read memory link":
					await page.getByRole("link", { name: "查看记忆", exact: true }).click();
					break;
				case "sidebar":
					await page
						.getByRole("navigation", { name: "主导航", exact: true })
						.getByRole("button", { name: "设置", exact: true })
						.click();
					break;
				case "command palette":
					await page.getByRole("button", { name: "搜索与命令", exact: true }).click();
					await page.getByRole("combobox", { name: "搜索页面或记忆", exact: true }).fill("设置");
					await page.getByRole("option", { name: "设置", exact: true }).click();
					break;
				case "browser Back":
					await page.goBack();
					break;
			}
		}
		const confirmation = page.getByRole("alertdialog", {
			name: "放弃未保存的修改？",
			exact: true,
		});
		await leaveEditor();
		await expect(confirmation).toBeVisible();
		await confirmation.getByRole("button", { name: "继续编辑", exact: true }).click();
		await expect(confirmation).not.toBeVisible();
		await expect(page).toHaveURL(editURL);
		await expect(body).toHaveValue(draft);
		expect(await admin.json<TestMemory>(path)).toMatchObject({
			body: memory.body,
			version: memory.version,
		});
		await leaveEditor();
		await expect(confirmation).toBeVisible();
		await confirmation.getByRole("button", { name: "放弃修改", exact: true }).click();
		await expect(confirmation).not.toBeVisible();
		const toSettings = navigation === "sidebar" || navigation === "command palette";
		await expect(page).toHaveURL(new RegExp(`${toSettings ? "/settings" : path}$`));
		await expect(
			page.getByRole("heading", { name: toSettings ? "设置" : memory.title, exact: true }),
		).toBeVisible();
		expect(await admin.json<TestMemory>(path)).toMatchObject({
			body: memory.body,
			version: memory.version,
		});
	});
}

test("mobile reader keeps content and TOC usable without horizontal overflow", async ({
	page,
	admin,
}, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const memory = await admin.memory();
	await page.goto(`/memories/${encodeURIComponent(memory.id)}`);
	await expect(page.getByRole("heading", { name: memory.title, exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "本页目录", exact: true }).click();
	await expect(page.getByRole("link", { name: "Details", exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Details", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Details", exact: true })).toBeInViewport();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await capture(page, info, "memory-reader-mobile");
});
