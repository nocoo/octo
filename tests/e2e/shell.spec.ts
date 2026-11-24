import { expect, test } from "./fixtures";

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

test("primary routes render cleanly without errors", async ({ page }) => {
	for (const [route, heading] of [
		["/", "总览"],
		["/memories", "记忆库"],
		["/keys", "接口密钥"],
		["/trash", "回收站"],
		["/audit", "审计日志"],
		["/settings", "设置"],
	] as const) {
		await page.goto(route);
		await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
	}
});
