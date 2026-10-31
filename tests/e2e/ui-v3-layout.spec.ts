import { expect, test } from "./fixtures";

test("shared headings separate their metadata and memory filters align clear", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.setViewportSize({ width: 1440, height: 900 });
	for (const path of [`/memories?spaces=${memory.space}&types=note`, "/spaces", "/audit"]) {
		await page.goto(path);
		const meta = page.locator(".octo-page-meta");
		await expect(meta).toBeVisible();
		const gap = await meta.evaluate((element) => {
			const title = element.previousElementSibling;
			if (!title) throw new Error("Missing heading");
			return element.getBoundingClientRect().left - title.getBoundingClientRect().right;
		});
		expect(gap).toBeGreaterThanOrEqual(8);
	}
	await page.goto(`/memories?spaces=${memory.space}&types=note`);
	const form = page.getByRole("form", { name: "记忆筛选" });
	const clear = form.getByRole("button", { name: "清除筛选", exact: true });
	await expect(clear).toBeVisible();
	const bounds = await clear.boundingBox();
	if (!bounds) throw new Error("Missing clear button");
	for (const name of ["空间", "类型", "应用筛选"]) {
		const control = await form.getByRole("button", { name, exact: true }).boundingBox();
		if (!control) throw new Error("Missing filter control");
		expect(
			Math.abs(bounds.y + bounds.height / 2 - control.y - control.height / 2),
		).toBeLessThanOrEqual(2);
	}
	await clear.click();
	await expect(page).toHaveURL(/\/memories$/);
	await expect(clear).toHaveCount(0);
});

test("observability clear actions share the filter control row", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	for (const [path, label, field] of [
		["/usage", "用量筛选", "密钥标识"],
		["/audit", "审计筛选", "路由模板"],
	] as const) {
		await page.goto(path);
		await page.getByRole("button", { name: label, exact: true }).click();
		const clear = page
			.getByRole("group", { name: "筛选操作", exact: true })
			.getByRole("button", { name: "清除筛选", exact: true });
		const input = page.getByRole("textbox", { name: field, exact: true });
		await expect
			.poll(async () => {
				const buttonBox = await clear.boundingBox();
				const inputBox = await input.boundingBox();
				if (!buttonBox || !inputBox) return Infinity;
				return Math.abs(buttonBox.y + buttonBox.height / 2 - inputBox.y - inputBox.height / 2);
			})
			.toBeLessThanOrEqual(2);
	}
});
