import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";

test("space picker portals retain Basalt resets and keyboard feedback", async ({
	page,
	admin,
}, info) => {
	const suffix = randomUUID();
	for (const prefix of ["first", "second"]) {
		await admin.json("/spaces", "POST", {
			slug: `${prefix}-${suffix}`,
			name: `键盘验收 ${prefix} ${suffix}`,
		});
	}
	await page.goto("/keys");
	await page.getByRole("button", { name: "创建密钥", exact: true }).first().click();
	const editor = page.getByRole("dialog", { name: "创建接口密钥", exact: true });
	await editor.getByRole("combobox", { name: "角色模板", exact: true }).click();
	await page.getByRole("option", { name: "自定义", exact: true }).click();
	await editor.getByRole("button", { name: "空间", exact: true }).click();
	const search = page.getByPlaceholder("搜索空间名称或标识", { exact: true });
	await search.fill(suffix);
	const list = page.getByRole("listbox", { name: "空间", exact: true });
	const options = list.getByRole("option");
	await expect(options).toHaveCount(2);
	const style = await options.first().evaluate((element) => {
		const style = getComputedStyle(element);
		return { background: style.backgroundColor, border: style.borderTopWidth };
	});
	expect(style).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px" });
	await search.press("ArrowDown");
	await expect(options.nth(1)).toHaveAttribute("data-hover-active", "true");
	await expect(list).toHaveAttribute("data-hover-visible", "true");
	const highlight = await list.evaluate((element) => {
		const style = getComputedStyle(element, "::before");
		return { opacity: style.opacity, background: style.backgroundImage, height: style.height };
	});
	expect(highlight.opacity).toBe("1");
	expect(highlight.background).not.toBe("none");
	expect(Number.parseFloat(highlight.height)).toBeGreaterThan(0);
	await capture(page, info, "keys-form-picker-keyboard");
	await search.press("Enter");
	await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
	await search.press("Escape");
	await expect(page.getByRole("listbox", { name: "空间", exact: true })).not.toBeVisible();
	await expect(editor).toBeVisible();
	await expect(editor.getByRole("button", { name: "空间", exact: true })).toBeFocused();
	await expect(editor.getByRole("button", { name: "空间", exact: true })).toContainText(
		"已选择 1 个空间",
	);
});
