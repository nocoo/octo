import { capture, expect, test } from "./fixtures";

for (const colorScheme of ["light", "dark"] as const) {
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 390, height: 844 },
		{ width: 844, height: 390 },
	]) {
		test(`command palette geometry ${colorScheme} ${viewport.width}`, async ({ page }, info) => {
			await page.setViewportSize(viewport);
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			await page.goto("/");
			await page.getByRole("button", { name: "搜索与命令", exact: true }).click();
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			await expect(dialog).toHaveCSS("padding", "0px");
			await expect(dialog.getByRole("combobox")).toBeFocused();
			await expect(dialog.getByText("打开", { exact: true })).toBeInViewport({ ratio: 1 });
			await expect(dialog.getByText(/Esc\s*关闭/)).toBeInViewport({ ratio: 1 });
			const items = dialog.getByRole("option");
			expect(await items.count()).toBeGreaterThan(10);
			await expect(items.locator("svg:first-child")).toHaveCount(await items.count());
			await expect(items.first().locator("svg:first-child")).toHaveCSS("width", "20px");
			await page.keyboard.press("End");
			const last = items.last();
			await expect(last).toHaveAttribute("aria-selected", "true");
			await expect(last).toBeInViewport({ ratio: 1 });
			const bounds = await dialog.boundingBox();
			expect(bounds?.height).toBeLessThan(viewport.height);
			expect(bounds?.width).toBeLessThan(viewport.width);
			await capture(page, info, `command-${colorScheme}-${viewport.width}`);
		});
	}
}

test("command palette keeps one sidebar search entry and keyboard search navigation", async ({
	page,
}) => {
	await page.goto("/");
	const rail = page.locator("[data-basalt-sidebar]");
	await expect(rail.getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
	const opener = rail.getByRole("button", { name: /搜索与命令/ });
	await opener.click();
	const input = page.getByRole("combobox", { name: "搜索页面或记忆" });
	await input.fill("garden & tea");
	const search = page.getByRole("option", { name: /搜索记忆/ });
	await expect(search).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/search\?q=garden%20%26%20tea$/);
	await expect(page.getByRole("textbox", { name: "搜索记忆", exact: true })).toHaveValue(
		"garden & tea",
	);
	await opener.click();
	await expect(input).toHaveValue("");
	await page.keyboard.press("Escape");
	await expect(input).not.toBeVisible();
	await expect(opener).toBeFocused();
	await opener.click();
	await input.fill("设置");
	await page.getByRole("option", { name: "设置", exact: true }).click();
	await expect(page).toHaveURL(/\/settings$/);
});
