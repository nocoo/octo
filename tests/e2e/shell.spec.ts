import { capture, expect, test } from "./fixtures";

test("back navigation sits left of the page title and inline metadata", async ({ page }, info) => {
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/audit");
		const header = page.locator("[data-basalt-header]");
		await expect(header.getByRole("button", { name: "返回上一页" })).toHaveCount(0);
		const section = page.locator(".octo-page-header");
		const back = section.getByRole("button", { name: "返回上一页" });
		const title = section.getByRole("heading", { level: 1 });
		const meta = section.locator(".octo-page-meta");
		await expect(back).toBeInViewport({ ratio: 1 });
		await expect(back.locator("svg")).toHaveCSS("width", "20px");
		const b = await back.boundingBox();
		const t = await title.boundingBox();
		const m = await meta.boundingBox();
		expect(b && t && m).toBeTruthy();
		if (!b || !t || !m) throw new Error("Missing page header geometry");
		expect(b.x + b.width).toBeLessThan(t.x);
		expect(t.x + t.width).toBeLessThan(m.x);
		expect(Math.abs(b.y + b.height / 2 - (t.y + t.height / 2))).toBeLessThan(3);
		await section.getByRole("button", { name: "审计筛选", exact: true }).click();
		const filterForm = page
			.locator("form")
			.filter({ has: page.getByRole("group", { name: "日期范围" }) });
		await expect(filterForm).toBeVisible();
		await expect(filterForm.getByRole("button", { name: "应用筛选" })).toBeVisible();
		await capture(page, info, `page-back-${width}`);
	}
});

test("header actions match Giraffe geometry and logo accent in both themes", async ({ page }) => {
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
		expect(geometry.controls).toEqual([
			...Array.from({ length: 2 }, () => ({ width: 34, height: 34, icon: 18 })),
			{ width: 34, height: 34, icon: 14 },
		]);
		expect(
			await page
				.locator("[data-basalt-header]")
				.evaluate((el) => el.getBoundingClientRect().height),
		).toBe(56);
		const type = await page.locator(".octo-version").evaluate((el) => ({
			font: getComputedStyle(el).fontFamily,
			size: getComputedStyle(el).fontSize,
		}));
		expect(type.font).toContain("mono");
		expect(type.size).toBe("12px");
		await expect(page.locator("html")).toHaveAttribute("data-accent", "sky");
		const colors = await page.evaluate(() => {
			const style = getComputedStyle(document.documentElement);
			return {
				swatch: style.getPropertyValue("--basalt-accent-2").trim(),
				primary: style.getPropertyValue("--basalt-primary").trim(),
			};
		});
		expect(colors.swatch).toBe(colorScheme === "light" ? "210 72% 56%" : "210 72% 68%");
		expect(colors.primary).toBe(colorScheme === "light" ? "210 72% 41%" : "210 72% 68%");
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

test("sidebar groups, collapsed search and content insets match the reference shell", async ({
	page,
}) => {
	await page.goto("/settings");
	const rail = page.locator("[data-basalt-sidebar]");
	const group = rail.getByRole("button", { name: "工作台", exact: true });
	await expect(group).toHaveAttribute("aria-expanded", "true");
	await group.click();
	await expect(rail.getByRole("button", { name: "记忆库", exact: true })).not.toBeVisible();
	await group.click();
	await expect(rail.getByRole("button", { name: "记忆库", exact: true })).toBeVisible();
	await rail.getByRole("button", { name: "收起侧栏", exact: true }).click();
	await rail.getByRole("button", { name: "搜索命令 (⌘K)", exact: true }).click();
	await expect(page.getByRole("listbox")).toBeVisible();
	await page.keyboard.press("Escape");
	await rail.getByRole("button", { name: "展开侧栏", exact: true }).click();
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		const island = page.locator("[data-basalt-island]");
		await expect(island).toHaveCSS("margin-inline-start", width < 768 ? "8px" : "12px");
		await expect(island).toHaveCSS("padding", width < 768 ? "16px" : "24px 32px");
		expect((await island.boundingBox())?.y).toBe(56);
	}
});

test("mobile navigation restores focus to its opener", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/search");
	const opener = page.getByRole("button", { name: "打开导航", exact: true });
	await opener.click();
	const navigation = page.locator("[data-basalt-sheet]");
	await expect(navigation).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(navigation).not.toBeVisible();
	await expect(opener).toBeFocused();
});

test("sidebar toggles preserve keyboard focus and report the active rail state", async ({
	page,
}) => {
	await page.goto("/settings");
	const close = page.getByRole("button", { name: "收起侧栏", exact: true });
	const open = page.getByRole("button", { name: "展开侧栏", exact: true });
	await close.focus();
	await page.keyboard.press("Enter");
	await expect(open).toBeFocused();
	await page.keyboard.press("Space");
	await expect(close).toBeFocused();
	await page.keyboard.press("Enter");
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: "打开导航", exact: true }).click();
	await expect(close).toHaveAttribute("aria-expanded", "true");
	await close.click();
	await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeFocused();
});

test.describe("touch shell", () => {
	test.use({ hasTouch: true });
	test("preserves full touch targets without clipping header actions", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/settings/embedding");
		expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
		for (const name of [
			"打开导航",
			"返回上一页",
			"GitHub 仓库",
			"Octo 项目主页",
			"切换深色或浅色主题",
		]) {
			const action = page.getByLabel(name, { exact: true });
			await expect(action).toBeInViewport({ ratio: 1 });
			const box = await action.boundingBox();
			expect(box?.width).toBeGreaterThanOrEqual(44);
			expect(box?.height).toBeGreaterThanOrEqual(44);
		}
	});
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
			expect(await center('[data-slot="sidebar-footer"] [role="img"]')).toBe(34);
			const search = rail.getByRole("button", { name: "搜索与命令" });
			expect((await search.boundingBox())?.width).toBe(244);
			expect((await search.boundingBox())?.height).toBeCloseTo(39.14, 1);
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
	for (const action of ["GitHub 仓库", "Octo 项目主页", "切换深色或浅色主题"])
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
		await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
		const chrome = page.locator(".octo-page-header");
		const backBox = await chrome.getByRole("button", { name: "返回上一页" }).boundingBox();
		const titleBox = await chrome.getByRole("heading", { level: 1 }).boundingBox();
		expect(backBox && titleBox).toBeTruthy();
		expect((backBox?.x ?? 0) + (backBox?.width ?? 0)).toBeLessThan(titleBox?.x ?? 0);
		await expect(page.locator('[data-slot="card-header"] h2')).toHaveCount(0);
		await expect(page.getByRole("button", { name: "返回上一页", exact: true })).toBeVisible();
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
			await page.keyboard.press("ControlOrMeta+k");
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
