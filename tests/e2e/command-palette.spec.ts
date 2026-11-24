import { expect, test } from "./fixtures";

test("command palette keeps one sidebar search entry and keyboard search navigation", async ({
	page,
}) => {
	await page.goto("/");
	const rail = page.locator("[data-basalt-sidebar]");
	await expect(rail.getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
	const opener = rail.getByRole("button", { name: /搜索与命令/ });
	await opener.click();
	const input = page.getByPlaceholder("跳转页面，或搜索记忆…", { exact: true });
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
