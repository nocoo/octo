import { capture, expect, test } from "./fixtures";

test("section titles remain readable on narrow dark pages", async ({ page, admin }, info) => {
	const memory = await admin.memory("# Reading\n\nA short memory body.");
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	for (const path of ["/", "/settings", `/memories/${memory.id}`]) {
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		const headings = page.locator("section.basalt-ui > div:first-child h2");
		await expect(headings.first()).toBeVisible();
		expect(
			await headings.evaluateAll((elements) =>
				elements.every((element) => element.scrollWidth <= element.clientWidth + 1),
			),
		).toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await capture(
			page,
			info,
			`narrow-dark-sections-${path.split("/").filter(Boolean).join("-") || "overview"}`,
		);
	}
});

test("functional section titles sit outside their cards using Basalt section chrome", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory("# Reading\n\nA short memory body.");
	await admin.json(
		`/memories/${memory.id}`,
		"PATCH",
		{ body: "# Reading\n\nAn updated memory body." },
		{ "If-Match": String(memory.version) },
	);
	const cases: [string, string[]][] = [
		["/", ["知识入口", "智能体活动 · 按密钥小时汇总", "调用趋势", "最近变更", "最近更新的记忆"]],
		["/settings", ["应用信息", "嵌入配置"]],
		[`/memories/${memory.id}`, ["详细信息", "附件", "版本时间线"]],
		[`/memories/${memory.id}/edit`, ["Markdown 正文", "实时预览"]],
		[`/memories/${memory.id}/history?from=1&to=2`, ["变更 / 第 1 版至第 2 版", "版本快照"]],
	];
	for (const [path, titles] of cases) {
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		for (const title of titles) {
			const heading = page.getByRole("heading", { name: title, exact: true });
			await expect(heading).toBeVisible();
			expect(
				await heading.evaluate((element) => ({
					inCard: element.closest("[data-basalt-surface]") !== null,
					section: element.closest("section")?.classList.contains("basalt-ui"),
				})),
			).toEqual({ inCard: false, section: true });
		}
		await expect(page.locator('[data-slot="card-header"] h2')).toHaveCount(0);
		if (path.endsWith("/edit")) {
			const editorLabel = page
				.getByRole("heading", { name: "Markdown 正文", exact: true })
				.locator("label");
			const preview = page.getByRole("heading", { name: "实时预览", exact: true });
			await expect(editorLabel).toHaveCSS(
				"font-size",
				await preview.evaluate((el) => getComputedStyle(el).fontSize),
			);
			const heights = await page
				.locator(".octo-memory-editor > section > [data-basalt-surface]")
				.evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
			expect(heights).toHaveLength(2);
			expect(Math.abs((heights[0] ?? 0) - (heights[1] ?? 0))).toBeLessThan(1);
		}
		await capture(
			page,
			info,
			`sections-${path.split("/").filter(Boolean).join("-").split("?")[0] || "overview"}`,
		);
	}
	await page.goto(`/memories/${memory.id}`);
	await expect(page.locator(".octo-memory-body")).toBeVisible();
	await expect(page.getByRole("heading", { name: "正文", exact: true })).toHaveCount(0);
});
