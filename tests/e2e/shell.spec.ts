import { capture, expect, test } from "./fixtures";

test("header actions match the compact template and logo accent in both themes", async ({
	page,
}) => {
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme });
		await page.goto("/keys");
		const actions = page.locator("[data-basalt-header-actions]");
		await expect(actions).toBeVisible();
		const geometry = await actions.evaluate((element) => ({
			gap: getComputedStyle(element).gap,
			controls: [...element.querySelectorAll(":scope > button, :scope > a")].map((control) => ({
				width: control.getBoundingClientRect().width,
				height: control.getBoundingClientRect().height,
				icon: control.querySelector("svg")?.getBoundingClientRect().width,
			})),
		}));
		expect(geometry.gap).toBe("4px");
		expect(geometry.controls).toEqual(
			Array.from({ length: 4 }, () => ({ width: 32, height: 34, icon: 18 })),
		);
		await expect(page.locator("html")).toHaveAttribute("data-accent", "sky");
		expect(
			await page.evaluate(() =>
				getComputedStyle(document.documentElement).getPropertyValue("--basalt-primary").trim(),
			),
		).toBe(colorScheme === "light" ? "210 72% 56%" : "210 72% 68%");
	}
});

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

test("shell keeps brand and identity aligned through rail and theme changes", async ({ page }) => {
	await page.goto("/settings");
	await expect(page.getByText("l3@local", { exact: true })).toBeVisible();
	const rail = page.locator("[data-basalt-sidebar]");
	const center = async (selector: string) => {
		const box = await rail.locator(selector).boundingBox();
		expect(box).not.toBeNull();
		return (box?.x ?? 0) + (box?.width ?? 0) / 2;
	};
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		for (const width of [1440, 768]) {
			await page.setViewportSize({ width, height: 900 });
			const expanded = await center('img[alt="Octo"]');
			expect(await center('[data-slot="sidebar-footer"] [role="img"]')).toBeCloseTo(expanded, 0);
			await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
			await expect(page.getByRole("button", { name: "展开侧栏", exact: true })).toBeVisible();
			expect(await center('img[alt="Octo"]')).toBeCloseTo(expanded, 0);
			expect(await center('[data-slot="sidebar-footer"] [role="img"]')).toBeCloseTo(expanded, 0);
			await expect(page.getByRole("link", { name: "Octo 首页", exact: true })).toHaveAttribute(
				"href",
				"/",
			);
			await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
		}
	}
});

test("memory breadcrumbs link ancestors and retain the current page on mobile", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.goto(`/memories/${memory.id}/history`);
	const header = page.locator("[data-basalt-header]");
	await expect(header.getByRole("link", { name: "记忆库", exact: true })).toHaveAttribute(
		"href",
		"/memories",
	);
	await expect(header.getByRole("link", { name: "记忆详情", exact: true })).toHaveAttribute(
		"href",
		`/memories/${memory.id}`,
	);
	await expect(header.getByText("版本历史", { exact: true })).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(header.getByText("版本历史", { exact: true })).toBeVisible();
	for (const action of ["搜索与命令", "GitHub 仓库", "Octo 项目主页", "切换深色或浅色主题"])
		await expect(header.getByLabel(action, { exact: true })).toBeInViewport({ ratio: 1 });
	await page.setViewportSize({ width: 1440, height: 1000 });
	await header.getByRole("link", { name: "记忆详情", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/memories/${memory.id}$`));
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
	["/usage", "每日用量", ["/usage"]],
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
			const background = getComputedStyle(element).backgroundColor;
			const token = getComputedStyle(element).getPropertyValue("--basalt-primary-foreground");
			const probe = document.createElement("span");
			probe.style.color = "hsl(var(--basalt-primary-foreground))";
			element.appendChild(probe);
			const expected = getComputedStyle(probe).color;
			probe.remove();
			const luminance = (color: string) => {
				const channels =
					color
						.match(/[\d.]+/g)
						?.slice(0, 3)
						.map(Number) ?? [];
				if (channels.length !== 3) throw new Error("Expected computed RGB color");
				return channels.reduce((total, channel, index) => {
					const value = channel / 255;
					const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
					return total + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
				}, 0);
			};
			const foregroundLuminance = luminance(actual);
			const backgroundLuminance = luminance(background);
			const contrast =
				(Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
				(Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
			return { actual, expected, token, contrast };
		});
		expect(colors.token.trim()).not.toBe("");
		expect(colors.actual).toBe(colors.expected);
		expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
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
			await page.getByPlaceholder("跳转页面，或搜索记忆…", { exact: true }).fill("设置");
			await page.getByRole("option", { name: "设置", exact: true }).click();
			await expect(page).toHaveURL(/\/settings$/);
			await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
			expect(errors).toEqual([]);
			await capture(page, info, `theme-${colorScheme}-motion-${reducedMotion}`);
		});
	}
}
