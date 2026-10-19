import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";

test("renames a space through the dashboard and persists after reload", async ({
	page,
	admin,
}, info) => {
	const slug = `rename-${randomUUID()}`;
	const originalName = "字".repeat(256);
	await admin.json("/spaces", "POST", { slug, name: originalName, description: "保留说明" });
	await page.goto(`/spaces?q=${slug}`);
	await expect(
		page.getByRole("columnheader", { name: "操作", exact: true }).getByRole("button"),
	).toHaveCount(0);
	const opener = page.getByRole("button", { name: `重命名空间 ${originalName}`, exact: true });
	await expect(opener).toBeInViewport({ ratio: 1 });
	await expect(page.getByRole("link", { name: originalName, exact: true })).toHaveAttribute(
		"title",
		originalName,
	);
	await opener.click();
	const dialog = page.getByRole("dialog", { name: "重命名空间", exact: true });
	await expect(dialog.getByLabel("空间名称", { exact: true })).toHaveValue(originalName);
	await dialog.getByLabel("空间名称", { exact: true }).fill("更新后的知识库");
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/api/admin/spaces/${slug}`) &&
			response.request().method() === "PATCH",
	);
	await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
	expect((await saved).status()).toBe(200);
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole("link", { name: "更新后的知识库", exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("link", { name: "更新后的知识库", exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "重命名空间 更新后的知识库", exact: true }),
	).toBeInViewport({ ratio: 1 });
	await expect(page.getByRole("link", { name: originalName, exact: true })).toHaveCount(0);
	const persisted = await admin.json<{ name: string; slug: string; description: string }>(
		`/spaces/${slug}`,
	);
	expect(persisted).toMatchObject({ name: "更新后的知识库", slug, description: "保留说明" });
	await capture(page, info, "space-rename-persisted");
});

test("places local and API name validation beside the name field", async ({
	page,
	admin,
}, info) => {
	const slug = `rename-errors-${randomUUID()}`;
	await admin.json("/spaces", "POST", { slug, name: "校验空间" });
	let writes = 0;
	await page.route(`**/api/admin/spaces/${slug}`, async (route) => {
		writes++;
		await route.fulfill({
			status: 400,
			json: {
				error: {
					code: "validation_failed",
					message: "raw English must not leak",
					details: { issues: [{ path: "name", message: "Invalid name" }] },
				},
			},
		});
	});
	await page.setViewportSize({ width: 390, height: 640 });
	await page.goto(`/spaces?q=${slug}`);
	const opener = page.getByRole("button", { name: "重命名空间 校验空间", exact: true });
	await opener.click();
	const dialog = page.getByRole("dialog", { name: "重命名空间", exact: true });
	const name = dialog.getByLabel("空间名称", { exact: true });
	await name.fill("   ");
	await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
	await expect(name).toHaveAttribute("aria-invalid", "true");
	await expect(name).toHaveAttribute("aria-describedby", "space-rename-name-error");
	await expect(dialog.getByRole("alert")).toHaveText("请输入 1 至 256 个字符的空间名称。");
	expect(writes).toBe(0);
	await name.fill("合法名称");
	await expect(dialog.getByRole("alert")).toHaveCount(0);
	await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
	await expect(dialog.getByRole("alert")).toHaveText("请输入 1 至 256 个字符的空间名称。");
	await expect(name).toHaveValue("合法名称");
	await expect(dialog.getByRole("alert")).toBeInViewport();
	await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
	expect(await dialog.innerText()).not.toMatch(/raw English|Invalid name|Save|Cancel/);
	expect(writes).toBe(1);
	await capture(page, info, "space-rename-field-error-mobile");
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(opener).toBeFocused();
});

test("keeps failed writes in the dialog and allows cancellation without changing the space", async ({
	page,
	admin,
}) => {
	const slug = `rename-failure-${randomUUID()}`;
	await admin.json("/spaces", "POST", { slug, name: "故障空间" });
	await page.route(`**/api/admin/spaces/${slug}`, (route) =>
		route.fulfill({ status: 503, json: { error: { code: "unavailable" } } }),
	);
	await page.goto(`/spaces?q=${slug}`);
	const opener = page.getByRole("button", { name: "重命名空间 故障空间", exact: true });
	await opener.click();
	const dialog = page.getByRole("dialog", { name: "重命名空间", exact: true });
	await dialog.getByLabel("空间名称", { exact: true }).fill("未保存的名称");
	await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("服务暂时不可用，请稍后重试。");
	await expect(dialog.getByLabel("空间名称", { exact: true })).not.toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await dialog.getByRole("button", { name: "取消", exact: true }).click();
	await expect(opener).toBeFocused();
	await expect(page.getByRole("link", { name: "故障空间", exact: true })).toBeVisible();
	await opener.click();
	await expect(dialog.getByLabel("空间名称", { exact: true })).toHaveValue("故障空间");
	await expect(dialog.getByRole("alert")).toHaveCount(0);
});
