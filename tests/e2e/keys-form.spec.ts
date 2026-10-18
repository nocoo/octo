import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";

test("readonly space picker edits persist to the real server", async ({ page, admin }) => {
	const name = `readonly-${randomUUID()}`;
	const original = await admin.json<{ id: string; slug: string; name: string }>("/spaces", "POST", {
		slug: `original-${randomUUID()}`,
		name: "原始范围",
	});
	const replacement = await admin.json<{ id: string; slug: string; name: string }>(
		"/spaces",
		"POST",
		{ slug: `replacement-${randomUUID()}`, name: "替换范围" },
	);
	const created = await admin.json<{ key: { id: string } }>("/keys", "POST", {
		name,
		role: "readonly",
		scope: "spaces",
		space_ids: [original.id],
	});
	await page.goto("/keys");
	await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).click();
	const editor = page.getByRole("dialog", { name: "编辑接口密钥", exact: true });
	await editor.getByRole("button", { name: "空间", exact: true }).click();
	await page
		.getByRole("option", { name: `${original.name}（${original.slug}）`, exact: true })
		.click();
	await page
		.getByRole("option", { name: `${replacement.name}（${replacement.slug}）`, exact: true })
		.click();
	await page.keyboard.press("Escape");
	await editor.getByRole("button", { name: "保存权限", exact: true }).click();
	await expect(editor).not.toBeVisible();
	expect(await admin.json(`/keys/${created.key.id}`)).toMatchObject({
		role: "readonly",
		scope: "spaces",
		space_ids: [replacement.id],
	});
});

test("create and edit a project key with visible slug guidance", async ({ page, admin }, info) => {
	const name = `project-${randomUUID()}`;
	await page.goto("/keys");
	await page.getByRole("button", { name: "创建密钥", exact: true }).first().click();
	const editor = page.getByRole("dialog", { name: "创建接口密钥", exact: true });
	const autoSpace = editor.getByRole("switch", { name: "自动创建自有空间", exact: true });
	await expect(autoSpace).toBeVisible();
	await expect(autoSpace).toBeDisabled();
	await capture(page, info, "keys-form-default");
	await editor.getByRole("textbox", { name: "代理名称", exact: true }).fill("Invalid Project Name");
	await editor.getByRole("button", { name: "创建密钥", exact: true }).click();
	await expect(editor.getByRole("textbox", { name: "代理名称", exact: true })).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(editor.getByRole("alert").filter({ hasText: "请检查标记的字段" })).toBeVisible();
	await capture(page, info, "keys-form-field-error");
	await editor.getByRole("textbox", { name: "代理名称", exact: true }).fill(name);
	const submitted = page.waitForRequest(
		(request) => request.method() === "POST" && request.url().endsWith("/api/admin/keys"),
	);
	await editor.getByRole("button", { name: "创建密钥", exact: true }).click();
	expect((await submitted).postDataJSON()).toEqual({ name, role: "project", expires_at: null });
	const reveal = page.getByRole("dialog", { name: "请立即复制密钥", exact: true });
	await expect.poll(() => reveal.isVisible()).toBe(true);
	await reveal.getByRole("button", { name: "关闭并清除", exact: true }).click();
	const listed = await admin.json<{ items: { id: string; name: string }[] }>("/keys");
	const key = listed.items.find((key) => key.name === name);
	expect(key).toBeDefined();
	await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).click();
	const edit = page.getByRole("dialog", { name: "编辑接口密钥", exact: true });
	await expect(edit.getByRole("switch", { name: "自动创建自有空间", exact: true })).toBeChecked();
	await edit.getByLabel("到期时间", { exact: true }).fill("2099-05-06T12:30");
	await edit.getByRole("button", { name: "保存权限", exact: true }).click();
	await expect(edit).not.toBeVisible();
	const metadata = await admin.json<{ expires_at: string; role: string; auto_own_space: boolean }>(
		`/keys/${key?.id}`,
	);
	expect(metadata).toMatchObject({ role: "project", auto_own_space: true });
	expect(Date.parse(metadata.expires_at)).toBeGreaterThan(Date.parse("2099-05-05T00:00:00Z"));
});

test("create and edit a custom key with the existing-space multiselect", async ({
	page,
	admin,
}, info) => {
	const name = `custom-${randomUUID()}`;
	const first = await admin.json<{ id: string; slug: string; name: string }>("/spaces", "POST", {
		slug: `first-${randomUUID()}`,
		name: "研究空间",
	});
	const second = await admin.json<{ id: string; slug: string; name: string }>("/spaces", "POST", {
		slug: `second-${randomUUID()}`,
		name: "共享空间",
	});
	await page.goto("/keys");
	await page.getByRole("button", { name: "创建密钥", exact: true }).first().click();
	const editor = page.getByRole("dialog", { name: "创建接口密钥", exact: true });
	await editor.getByRole("textbox", { name: "代理名称", exact: true }).fill(name);
	await editor.getByRole("combobox", { name: "角色模板", exact: true }).click();
	await page.getByRole("option", { name: "自定义", exact: true }).click();
	await editor.getByRole("checkbox", { name: "读取", exact: true }).check();
	await editor.getByRole("checkbox", { name: "创建", exact: true }).check();
	await editor.getByRole("button", { name: "空间", exact: true }).click();
	await expect(
		page.getByRole("option", { name: `${first.name}（${first.slug}）`, exact: true }),
	).toBeVisible();
	await capture(page, info, "keys-form-picker-open");
	await page.getByRole("option", { name: `${first.name}（${first.slug}）`, exact: true }).click();
	await page.getByRole("option", { name: `${second.name}（${second.slug}）`, exact: true }).click();
	await page.keyboard.press("Escape");
	await capture(page, info, "keys-form-picker-selected");
	const submitted = page.waitForRequest(
		(request) => request.method() === "POST" && request.url().endsWith("/api/admin/keys"),
	);
	await editor.getByRole("button", { name: "创建密钥", exact: true }).click();
	expect((await submitted).postDataJSON()).toEqual({
		name,
		role: "custom",
		ops: "r,w",
		scope: "spaces",
		space_ids: [first.id, second.id],
		own_entries_only: false,
		auto_own_space: false,
		expires_at: null,
	});
	const reveal = page.getByRole("dialog", { name: "请立即复制密钥", exact: true });
	await expect.poll(() => reveal.isVisible()).toBe(true);
	await reveal.getByRole("button", { name: "关闭并清除", exact: true }).click();
	const listed = await admin.json<{ items: { id: string; name: string }[] }>("/keys");
	const key = listed.items.find((key) => key.name === name);
	expect(key).toBeDefined();
	await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).click();
	const edit = page.getByRole("dialog", { name: "编辑接口密钥", exact: true });
	await edit.getByRole("button", { name: "空间", exact: true }).click();
	await expect(
		page.getByRole("option", { name: `${first.name}（${first.slug}）`, exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await page.getByRole("option", { name: `${first.name}（${first.slug}）`, exact: true }).click();
	await page.keyboard.press("Escape");
	await edit.getByRole("button", { name: "保存权限", exact: true }).click();
	await expect(edit).not.toBeVisible();
	expect(await admin.json(`/keys/${key?.id}`)).toMatchObject({
		ops: "r,w",
		scope: "spaces",
		space_ids: [second.id],
	});
});

test("show real server validation beside a space deleted after selection", async ({
	page,
	admin,
}, info) => {
	const space = await admin.json<{ id: string; slug: string; name: string }>("/spaces", "POST", {
		slug: `deleted-${randomUUID()}`,
		name: "临时空间",
	});
	await page.goto("/keys");
	await page.getByRole("button", { name: "创建密钥", exact: true }).first().click();
	const editor = page.getByRole("dialog", { name: "创建接口密钥", exact: true });
	await editor.getByRole("textbox", { name: "代理名称", exact: true }).fill("临时读取密钥");
	await editor.getByRole("combobox", { name: "角色模板", exact: true }).click();
	await page.getByRole("option", { name: "自定义", exact: true }).click();
	await expect(
		editor.getByRole("switch", { name: "自动创建自有空间", exact: true }),
	).toBeDisabled();
	await editor.getByRole("checkbox", { name: "读取", exact: true }).check();
	await editor.getByRole("button", { name: "空间", exact: true }).click();
	await page.getByRole("option", { name: `${space.name}（${space.slug}）`, exact: true }).click();
	await page.keyboard.press("Escape");
	await expect(editor.getByText(/当前名称不符合规则，无法启用/)).toBeVisible();
	await capture(page, info, "keys-form-auto-own-disabled");
	await admin.json(`/spaces/${space.slug}`, "DELETE");
	const rejected = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" && response.url().endsWith("/api/admin/keys"),
	);
	await editor.getByRole("button", { name: "创建密钥", exact: true }).click();
	expect((await rejected).status()).toBe(400);
	await expect(
		editor.getByText("请选择有效的现有空间；空间可能已删除，请刷新列表。", { exact: true }),
	).toBeVisible();
	await expect(editor.getByRole("alert").filter({ hasText: "请检查标记的字段" })).toBeVisible();
});
