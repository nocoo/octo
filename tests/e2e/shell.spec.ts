import { capture, expect, test } from "./fixtures";

test("slash focuses search on its first lazy navigation", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();
	await page.keyboard.press("/");
	await expect(page).toHaveURL(/\/search$/);
	const search = page.getByRole("textbox", { name: "搜索记忆", exact: true });
	await expect(search).toBeFocused();
	await page.keyboard.type("first search");
	await expect(search).toHaveValue("first search");
});

test("mobile navigation restores focus to its opener", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/search");
	const opener = page.getByRole("button", { name: "打开导航", exact: true });
	await opener.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).not.toBeVisible();
	await expect(opener).toBeFocused();
});

const pages = [
	["/", "总览", ["/spaces", "/usage", "/memories"]],
	["/memories", "记忆库", ["/memories"]],
	["/search", "搜索", []],
	["/tags", "标签", ["/tags", "/memories"]],
	["/spaces", "空间", ["/spaces", "/keys"]],
	["/graph", "关系图", ["/memories"]],
	["/timeline", "时间线", ["/memories"]],
	["/keys", "接口密钥", ["/keys"]],
	["/usage", "用量与健康状态", ["/usage"]],
	["/audit", "审计日志", ["/audit"]],
	["/trash", "回收站", ["/trash"]],
	["/settings", "设置", ["/embedding-profiles"]],
	["/settings/embedding", "向量模型", ["/settings/embedding"]],
] as const;

for (const [path, heading, endpoints] of pages) {
	test(`real page smoke: ${path}`, async ({ page, admin }, info) => {
		await admin.json("/whoami");
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const responses = endpoints.map((endpoint) =>
			page.waitForResponse(
				(response) => new URL(response.url()).pathname === `/api/admin${endpoint}`,
			),
		);
		await page.goto(path);
		for (const response of await Promise.all(responses))
			expect(
				response.ok(),
				`${path}: ${new URL(response.url()).pathname} HTTP ${response.status()}`,
			).toBe(true);
		await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
		await expect(page.getByRole("main")).toBeVisible();
		await expect(page.getByText("l3@local", { exact: true })).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
		expect(errors).toEqual([]);
		await capture(
			page,
			info,
			`page-${path === "/" ? "overview" : path.slice(1).replaceAll("/", "-")}`,
		);
	});
}

for (const colorScheme of ["light", "dark"] as const) {
	test(`${colorScheme} primary links retain the Basalt foreground`, async ({ page }) => {
		await page.emulateMedia({ colorScheme });
		await page.goto("/settings");
		const link = page.getByRole("link", { name: "配置嵌入网关", exact: true });
		await expect(link).toBeVisible();
		const colors = await link.evaluate((element) => {
			const actual = getComputedStyle(element).color;
			const token = getComputedStyle(element).getPropertyValue("--basalt-primary-foreground");
			const probe = document.createElement("span");
			probe.style.color = "hsl(var(--basalt-primary-foreground))";
			element.appendChild(probe);
			const expected = getComputedStyle(probe).color;
			probe.remove();
			return { actual, expected, token };
		});
		expect(colors.token.trim()).not.toBe("");
		expect(colors.actual).toBe(colors.expected);
	});
	for (const reducedMotion of ["no-preference", "reduce"] as const) {
		test(`${colorScheme} theme with motion ${reducedMotion}`, async ({ page, admin }, info) => {
			await page.emulateMedia({ colorScheme, reducedMotion });
			const memory = await admin.memory();
			await page.goto(`/memories/${encodeURIComponent(memory.id)}`);
			await expect(page.getByRole("heading", { name: memory.title, exact: true })).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("data-mode", colorScheme);
			if (reducedMotion === "reduce") {
				await page.evaluate(() => {
					Object.defineProperty(document, "startViewTransition", {
						configurable: true,
						value: () => {
							throw new Error("Reduced motion must not start a View Transition");
						},
					});
				});
			}
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.getByRole("button", { name: "搜索与命令", exact: true }).click();
			await expect(page.getByRole("listbox")).toHaveAccessibleName("搜索结果");
			await page.getByRole("combobox", { name: "搜索页面或记忆", exact: true }).fill("设置");
			await page.getByRole("option", { name: "设置", exact: true }).click();
			await expect(page).toHaveURL(/\/settings$/);
			await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
			expect(errors).toEqual([]);
			await capture(page, info, `theme-${colorScheme}-motion-${reducedMotion}`);
		});
	}
}
