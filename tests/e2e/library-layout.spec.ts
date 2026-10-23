import { capture, expect, test } from "./fixtures";

test("timeline switches between linked records and tables without duplicating content", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory();
	await page.setViewportSize({ width: 390, height: 844 });
	for (const zoom of ["day", "month"]) {
		await page.goto(`/timeline?field=created_at&zoom=${zoom}&space=${memory.space}`);
		const timeline = page.getByRole("list", { name: / 的记忆$/ }).filter({ hasText: memory.title });
		await expect(timeline.getByText(memory.title, { exact: true })).toBeVisible();
		await expect(timeline).toContainText(/\d{2}:\d{2}:\d{2} UTC/);
		if (zoom === "month") await expect(timeline).toContainText(/\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
		await expect(page.getByRole("table")).toHaveCount(0);
		await expect(timeline.getByRole("link", { name: memory.title })).toHaveAttribute(
			"href",
			`/memories/${memory.id}`,
		);
		await expect(timeline.getByRole("link", { name: memory.space })).toHaveAttribute(
			"href",
			`/memories?spaces=${memory.space}`,
		);
		await timeline.getByRole("checkbox").click();
		await expect(timeline.getByRole("checkbox")).toBeChecked();
		await page.getByRole("radio", { name: "表格", exact: true }).click();
		const table = page.getByRole("table", { name: / 的时间线数据$/ });
		await expect(table).toContainText(memory.space);
		await expect(table.locator('tbody [role="checkbox"]')).toBeChecked();
		await expect(page.getByRole("list", { name: / 的记忆$/ })).toHaveCount(0);
		await page.getByRole("radio", { name: "时间轴", exact: true }).click();
		await expect(timeline.getByRole("checkbox")).toBeChecked();
		expect(new URL(page.url()).searchParams.get("zoom")).toBe(zoom);
	}
	await capture(page, info, "timeline-visible-records");
});

test("timeline filters, grouped selections and responsive rails preserve navigation", async ({
	page,
	admin,
}, info) => {
	const first = await admin.memory();
	await admin.json(
		`/memories/${first.id}`,
		"PATCH",
		{ event_time: "2026-10-01T03:15:06Z" },
		{ "If-Match": String(first.version) },
	);
	const second = await admin.json<{ id: string; title: string }>("/memories", "POST", {
		space: first.space,
		title: "A second date",
		body: "Second event",
		type: "note",
		tags: [],
		event_time: "2026-10-02T03:15:06Z",
	});
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(
			`/timeline?space=${first.space}&from=2026-10-01T03%3A15%3A06Z&to=2026-10-02T03%3A15%3A06Z`,
		);
		await expect(page.locator(".octo-timeline-group")).toHaveCount(2);
		const groups = page.locator(".octo-timeline-group");
		await groups.nth(0).getByRole("checkbox").click();
		await expect(groups.nth(0).getByRole("checkbox")).toBeChecked();
		await groups.nth(1).getByRole("checkbox").click();
		await expect(groups.nth(1).getByRole("checkbox")).toBeChecked();
		expect(new URL(page.url()).searchParams.getAll("selected")).toEqual([first.id, second.id]);
		const date = await groups.first().locator(".octo-timeline-date").boundingBox();
		const records = await groups.first().getByRole("list").boundingBox();
		if (!date || !records) throw new Error("Missing timeline geometry");
		if (width === 1440) expect(date.x + date.width).toBeLessThan(records.x);
		else expect(date.y + date.height).toBeLessThan(records.y);
		await expect(
			page.locator(".octo-timeline-content").first().locator("[data-tag-color]"),
		).toHaveCount(0);
		await capture(page, info, `timeline-rail-${width}`);
		await page.getByRole("button", { name: "移除结束时间筛选" }).click();
		expect(new URL(page.url()).searchParams.has("to")).toBe(false);
		await page.getByRole("button", { name: "清除范围筛选" }).click();
		const params = new URL(page.url()).searchParams;
		expect(params.has("space")).toBe(false);
		expect(params.has("from")).toBe(false);
		expect(params.getAll("selected")).toEqual([first.id, second.id]);
	}
	await page.goto(`/timeline?space=${first.space}`);
	await page.getByRole("link", { name: first.title, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/memories/${first.id}$`));
	await page.getByRole("button", { name: "返回上一页", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/timeline\\?space=${first.space}$`));
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
