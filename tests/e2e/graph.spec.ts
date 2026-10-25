import { capture, expect, test } from "./fixtures";

test("图谱沉浸画布填满内容岛并避免文档纵向滚动", async ({ page, admin }, info) => {
	await admin.memory();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/graph");

	const stage = page.locator(".octo-graph-stage");
	await expect(stage).toBeVisible();
	await expect(page.getByRole("img", { name: /^力导向关系图/ })).toBeVisible();
	await expect
		.poll(async () => {
			const stageBox = await stage.boundingBox();
			return stageBox?.height ?? 0;
		})
		.toBeGreaterThan(500);

	await expect
		.poll(() =>
			page.evaluate(() => {
				const island = document.querySelector("[data-basalt-island]");
				const stage = document.querySelector(".octo-graph-stage");
				if (!island || !stage) throw new Error("缺少图谱或内容岛");
				const inset = Number.parseFloat(getComputedStyle(island).paddingBottom);
				return Math.abs(
					Math.round(
						island.getBoundingClientRect().bottom - inset - stage.getBoundingClientRect().bottom,
					),
				);
			}),
		)
		.toBeLessThanOrEqual(4);
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
		.toBeLessThanOrEqual(2);
	await capture(page, info, "graph-immersive-1440");
});

test("目录选择同步 URL 并显示可关闭的节点详情", async ({ page, admin }) => {
	const memory = await admin.memory();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/graph");

	const directory = page.locator(".octo-graph-panel--directory");
	const search = directory.getByRole("textbox", { name: "搜索节点", exact: true });
	await search.fill(memory.title);
	const row = directory.locator(".octo-graph-row").filter({ hasText: memory.title });
	await expect(row).toBeVisible();
	await row.click();

	await expect.poll(() => new URL(page.url()).searchParams.get("node")).toBe(`memory:${memory.id}`);
	const inspector = page.locator(".octo-graph-panel--inspector");
	await expect(inspector).toBeVisible();
	await expect(inspector).toContainText(memory.title);
	await expect(inspector.getByRole("link", { name: "打开记忆", exact: true })).toHaveAttribute(
		"href",
		`/memories/${memory.id}`,
	);
	await expect(inspector.locator(".octo-graph-row")).toHaveCount(2);

	await inspector.getByRole("button", { name: "关闭节点详情", exact: true }).click();
	await expect.poll(() => new URL(page.url()).searchParams.has("node")).toBe(false);
	await expect(inspector).toBeHidden();
});

test("关系图工具切换节点名称、布局计算并打开数据表", async ({ page, admin }) => {
	await admin.memory();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/graph");

	const toolbar = page.getByRole("toolbar", { name: "关系图工具", exact: true });
	const labels = toolbar.getByRole("button", { name: "显示节点名称", exact: true });
	await expect(labels).toHaveAttribute("aria-pressed", "true");
	await labels.click();
	await expect(labels).toHaveAttribute("aria-pressed", "false");
	await labels.click();
	await expect(labels).toHaveAttribute("aria-pressed", "true");

	const pause = toolbar.getByRole("button", { name: "暂停布局计算", exact: true });
	await expect(pause).toHaveAttribute("aria-pressed", "false");
	await pause.click();
	const resume = toolbar.getByRole("button", { name: "继续布局计算", exact: true });
	await expect(resume).toHaveAttribute("aria-pressed", "true");
	await resume.click();
	await expect(toolbar.getByRole("button", { name: "暂停布局计算", exact: true })).toHaveAttribute(
		"aria-pressed",
		"false",
	);

	await toolbar.getByRole("button", { name: "图谱数据表", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "图谱数据表", exact: true });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("table", { name: "图谱节点", exact: true })).toBeVisible();
	await expect(sheet.getByRole("table", { name: "图谱关系", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
});

test("窄屏用节点列表与详情 Sheet 浏览关系图", async ({ page, admin }, info) => {
	const memory = await admin.memory();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/graph");

	const directoryPanel = page.locator(".octo-graph-panel--directory");
	const inspectorPanel = page.locator(".octo-graph-panel--inspector");
	await expect(directoryPanel).toBeHidden();
	await expect(inspectorPanel).toBeHidden();
	await expect(page.getByRole("img", { name: /^力导向关系图/ })).toBeVisible();
	await capture(page, info, "graph-compact-canvas");

	const toolbar = page.getByRole("toolbar", { name: "关系图工具", exact: true });
	await toolbar.getByRole("button", { name: "节点列表", exact: true }).click();
	const listSheet = page.getByRole("dialog", { name: "节点列表", exact: true });
	await expect(listSheet).toBeVisible();
	const row = listSheet.locator(".octo-graph-row").filter({ hasText: memory.title });
	await expect(row).toBeVisible();
	await capture(page, info, "graph-compact-directory-sheet");
	await row.click();

	await expect(listSheet).toBeHidden();
	const detailSheet = page.getByRole("dialog", { name: "节点详情", exact: true });
	await expect(detailSheet).toBeVisible();
	await expect(detailSheet).toContainText(memory.title);
	await capture(page, info, "graph-compact-detail-sheet");
	await page.keyboard.press("Escape");
	await expect(detailSheet).toBeHidden();
});
