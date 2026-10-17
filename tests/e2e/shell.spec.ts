import { capture, expect, test } from "./fixtures";

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
	["/memories", "Memories", ["/memories"]],
	["/search", "Search", []],
	["/tags", "Tags", ["/tags", "/memories"]],
	["/spaces", "Spaces", ["/spaces", "/keys"]],
	["/graph", "Relationship graph", ["/memories"]],
	["/timeline", "Timeline", ["/memories"]],
	["/keys", "API keys", ["/keys"]],
	["/usage", "Usage and health", ["/usage"]],
	["/audit", "Audit log", ["/audit"]],
	["/trash", "Trash", ["/trash"]],
	["/settings", "Settings", ["/embedding-profiles"]],
	["/settings/embedding", "Embedding gateway", ["/settings/embedding"]],
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
			await page.getByRole("combobox", { name: "搜索页面或记忆", exact: true }).fill("设置");
			await page.getByRole("option", { name: "设置", exact: true }).click();
			await expect(page).toHaveURL(/\/settings$/);
			await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
			expect(errors).toEqual([]);
			await capture(page, info, `theme-${colorScheme}-motion-${reducedMotion}`);
		});
	}
}
