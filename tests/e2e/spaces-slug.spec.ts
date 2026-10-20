import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";

test("persists the canonical slug after reload and retains the space memories", async ({
	page,
	admin,
}, info) => {
	const slug = `slug-${randomUUID()}`;
	const renamedSlug = `renamed-${randomUUID()}`;
	const original = await admin.json<{ id: string; updated_at: string }>("/spaces", "POST", {
		slug,
		name: "保留记忆的空间",
		description: "保留空间说明",
	});
	const memory = await admin.json<{ id: string; title: string }>("/memories", "POST", {
		space: slug,
		title: `保留的记忆 ${randomUUID()}`,
		body: "标识修改后正文保持不变。",
		type: "note",
		tags: [],
	});
	await page.goto(`/spaces?q=${slug}`);
	await page.getByRole("button", { name: "重命名空间 保留记忆的空间", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "重命名空间", exact: true });
	await expect(dialog.getByLabel("空间标识", { exact: true })).toHaveValue(slug);
	await dialog.getByLabel("空间标识", { exact: true }).fill(renamedSlug);
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/api/admin/spaces/${slug}`) &&
			response.request().method() === "PATCH",
	);
	await dialog.getByRole("button", { name: "保存更改", exact: true }).click();
	const response = await saved;
	expect(response.status()).toBe(200);
	expect(response.request().headers()["if-match"]).toBe(String(Date.parse(original.updated_at)));
	expect(await response.json()).toMatchObject({
		id: original.id,
		slug: renamedSlug,
		memory_count: 1,
	});
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole("textbox", { name: "筛选空间", exact: true })).toHaveValue(slug);
	await page.getByRole("textbox", { name: "筛选空间", exact: true }).fill(renamedSlug);
	await page.reload();
	const link = page.getByRole("link", { name: "保留记忆的空间", exact: true });
	await expect(link).toHaveAttribute("href", `/memories?spaces=${renamedSlug}`);
	await expect(page.getByRole("cell", { name: renamedSlug, exact: true })).toBeVisible();
	expect(await admin.json(`/spaces/${slug}`)).toMatchObject({
		id: original.id,
		slug: renamedSlug,
		name: "保留记忆的空间",
		description: "保留空间说明",
		memory_count: 1,
	});
	await link.click();
	await expect(page.getByRole("link", { name: memory.title, exact: true })).toBeVisible();
	expect(await admin.json(`/memories/${memory.id}`)).toMatchObject({
		id: memory.id,
		space: renamedSlug,
		body: "标识修改后正文保持不变。",
	});
	await capture(page, info, "space-slug-memories-retained");
});

test("shows invalid and duplicate slug errors beside the field using the real API", async ({
	page,
	admin,
}, info) => {
	const slug = `slug-errors-${randomUUID()}`;
	const taken = `taken-${randomUUID()}`;
	await admin.json("/spaces", "POST", { slug, name: "标识校验空间" });
	await admin.json("/spaces", "POST", { slug: taken, name: "已占用标识" });
	await page.setViewportSize({ width: 390, height: 740 });
	await page.goto(`/spaces?q=${slug}`);
	const opener = page.getByRole("button", { name: "重命名空间 标识校验空间", exact: true });
	await opener.click();
	const dialog = page.getByRole("dialog", { name: "重命名空间", exact: true });
	const field = dialog.getByLabel("空间标识", { exact: true });
	let writes = 0;
	page.on("request", (request) => {
		if (request.method() === "PATCH" && request.url().endsWith(`/api/admin/spaces/${slug}`))
			writes++;
	});
	for (const invalid of ["", "Bad Slug", "a--b", "a".repeat(65)]) {
		await field.fill(invalid);
		await dialog.getByRole("button", { name: "保存更改", exact: true }).click();
		await expect(field).toHaveAttribute("aria-invalid", "true");
		await expect(field).toHaveAttribute("aria-describedby", "space-rename-slug-error");
		await expect(dialog.getByRole("alert")).toHaveText(
			"请输入 1 至 64 位小写字母、数字与单连字符，不能以连字符开头或结尾。",
		);
	}
	expect(writes).toBe(0);
	await field.fill(taken);
	await expect(dialog.getByRole("alert")).toHaveCount(0);
	const rejected = page.waitForResponse(
		(response) =>
			response.request().method() === "PATCH" &&
			response.url().endsWith(`/api/admin/spaces/${slug}`),
	);
	await dialog.getByRole("button", { name: "保存更改", exact: true }).click();
	expect((await rejected).status()).toBe(409);
	await expect(field).toHaveValue(taken);
	await expect(field).toHaveAttribute("aria-invalid", "true");
	await expect(dialog.getByRole("alert")).toHaveText("空间标识已被占用，请使用其他标识。");
	await expect(dialog.getByRole("alert")).toBeInViewport();
	await expect(dialog.getByLabel("空间名称", { exact: true })).not.toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
	expect(writes).toBe(1);
	expect(await dialog.innerText()).not.toMatch(/space slug already exists|version_conflict/);
	await capture(page, info, "space-slug-duplicate-mobile");
	await page.keyboard.press("Escape");
	await expect(opener).toBeFocused();
	expect(await admin.json(`/spaces/${slug}`)).toMatchObject({ slug, name: "标识校验空间" });
});

test("keeps stale timestamp conflicts in the dialog without overwriting newer space data", async ({
	page,
	admin,
}) => {
	const slug = `slug-stale-${randomUUID()}`;
	await admin.json("/spaces", "POST", { slug, name: "并发修改空间" });
	await page.goto(`/spaces?q=${slug}`);
	await page.getByRole("button", { name: "重命名空间 并发修改空间", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "重命名空间", exact: true });
	await dialog.getByLabel("空间标识", { exact: true }).fill(`new-${randomUUID()}`);
	await admin.json(`/spaces/${slug}`, "PATCH", { name: "其他窗口的新名称" });
	const rejected = page.waitForResponse(
		(response) =>
			response.request().method() === "PATCH" &&
			response.url().endsWith(`/api/admin/spaces/${slug}`),
	);
	await dialog.getByRole("button", { name: "保存更改", exact: true }).click();
	expect((await rejected).status()).toBe(412);
	await expect(dialog.getByRole("alert")).toContainText("内容已被修改，请刷新后重试。");
	await expect(dialog.getByLabel("空间标识", { exact: true })).not.toHaveAttribute(
		"aria-invalid",
		"true",
	);
	expect(await admin.json(`/spaces/${slug}`)).toMatchObject({ slug, name: "其他窗口的新名称" });
});
