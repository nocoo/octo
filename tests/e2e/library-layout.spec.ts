import { capture, expect, test } from "./fixtures";

test("timeline renders contemporary records with compact UTC labels and an exact data alternative", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory();
	await page.setViewportSize({ width: 390, height: 844 });
	for (const zoom of ["day", "month"]) {
		await page.goto(`/timeline?field=created_at&zoom=${zoom}&space=${memory.space}`);
		const timeline = page.getByRole("list", { name: / 的记忆$/ }).filter({ hasText: memory.title });
		await expect(timeline.getByText(memory.title, { exact: true })).toBeVisible();
		await expect(timeline).toContainText(/\d{2}:\d{2} UTC/);
		if (zoom === "month") await expect(timeline).toContainText(/\d{2}-\d{2} \d{2}:\d{2} UTC/);
		await expect(page.getByRole("table", { name: / 的时间线数据$/ })).toContainText(memory.space);
	}
	await capture(page, info, "timeline-visible-records");
});

test("space creation keeps errors in its short-screen dialog and restores the actual opener", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 480 });
	await page.route("**/api/admin/spaces", async (route) => {
		if (route.request().method() === "POST")
			await route.fulfill({ status: 503, json: { error: { code: "unavailable" } } });
		else await route.continue();
	});
	await page.goto("/spaces");
	const opener = page.getByRole("button", { name: "创建空间", exact: true }).first();
	await expect(opener).toBeEnabled();
	await opener.focus();
	await expect(opener).toBeFocused();
	await opener.press("Enter");
	const dialog = page.getByRole("dialog", { name: "创建空间", exact: true });
	await dialog.getByLabel("空间标识", { exact: true }).fill("failure-fixture");
	await dialog.getByLabel("名称", { exact: true }).fill("Failure fixture");
	await dialog.getByRole("button", { name: "创建空间", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("创建失败");
	await dialog.getByRole("alert").scrollIntoViewIfNeeded();
	await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
	await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(opener).toBeFocused();
});

test("tag mutation errors retain the confirmation stage and keyboard return target", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	const tag = memory.space;
	await admin.json(
		`/memories/${memory.id}`,
		"PATCH",
		{ tags: [tag] },
		{ "If-Match": String(memory.version) },
	);
	await page.route(`**/api/admin/tags/${tag}/rename`, (route) =>
		route.fulfill({ status: 503, json: { error: { code: "unavailable" } } }),
	);
	await page.goto(`/tags?q=${tag}`);
	const opener = page.getByRole("button", { name: `重命名 ${tag}`, exact: true });
	await opener.click();
	const editor = page.getByRole("dialog");
	await editor.getByLabel("新标签名称", { exact: true }).fill(`${tag}-renamed`);
	await editor.getByRole("button", { name: "确认修改内容", exact: true }).click();
	const confirmation = page.getByRole("alertdialog");
	await confirmation.getByRole("button", { name: "重命名标签", exact: true }).click();
	await expect(confirmation.getByRole("alert")).toContainText("操作失败");
	await expect(editor).not.toBeVisible();
	await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
	await confirmation.getByRole("button", { name: "取消", exact: true }).click();
	await expect(confirmation).not.toBeVisible();
	await expect(opener).toBeFocused();
});

test("failed purge retains both completed safeguards and restores focus on cancel", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory();
	await admin.json(`/memories/${memory.id}`, "DELETE", undefined, {
		"If-Match": String(memory.version),
	});
	await page.route(`**/api/admin/trash/${memory.id}`, (route) =>
		route.fulfill({ status: 503, json: { error: { code: "unavailable" } } }),
	);
	await page.setViewportSize({ width: 390, height: 480 });
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await page.goto(`/trash?q=${encodeURIComponent(memory.title)}`);
	const opener = page.getByRole("button", { name: `永久删除 ${memory.title}`, exact: true });
	await opener.click();
	const titleDialog = page.getByRole("dialog", { name: "输入记忆标题", exact: true });
	await titleDialog.getByLabel("确认标题", { exact: true }).fill(memory.title);
	await titleDialog.getByRole("button", { name: "继续", exact: true }).click();
	const confirmation = page.getByRole("alertdialog", { name: "确认永久删除？", exact: true });
	await confirmation.getByRole("button", { name: "永久删除", exact: true }).click();
	await expect(confirmation.getByRole("alert")).toContainText("永久删除失败");
	await expect(confirmation.getByRole("alert")).toBeInViewport({ ratio: 1 });
	const contrast = await confirmation.getByRole("alert").evaluate((element) => {
		const luminance = (color: string) =>
			(color.match(/[\d.]+/g) ?? [])
				.slice(0, 3)
				.map(Number)
				.reduce((sum, channel, index) => {
					const value = channel / 255;
					const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
					return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
				}, 0);
		const dialog = element.closest('[role="alertdialog"]');
		if (!dialog) throw new Error("Expected confirmation-local feedback");
		const foreground = luminance(getComputedStyle(element).color);
		const background = luminance(getComputedStyle(dialog).backgroundColor);
		return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
	});
	expect(contrast).toBeGreaterThanOrEqual(4.5);
	await expect(titleDialog).not.toBeVisible();
	await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
	const trash = await admin.json<{ items: { id: string }[] }>("/trash");
	expect(trash.items.some((item) => item.id === memory.id)).toBe(true);
	await capture(page, info, "purge-failure-stays-in-confirmation");
	await confirmation.getByRole("button", { name: "取消", exact: true }).click();
	await expect(confirmation).not.toBeVisible();
	await expect(opener).toBeFocused();
});
