import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";

for (const editing of [false, true]) {
	test(`partial expiry cannot ${editing ? "clear an existing restriction" : "mint a nonexpiring key"}`, async ({
		page,
		admin,
	}, info) => {
		const name = `expiry-${randomUUID()}`;
		const originalExpiry = "2099-12-01T10:30:00.000Z";
		const created = editing
			? await admin.json<{ key: { id: string } }>("/keys", "POST", {
					name,
					role: "project",
					expires_at: originalExpiry,
				})
			: null;
		await page.goto("/keys");
		await page
			.getByRole("button", { name: editing ? `编辑 ${name}` : "创建密钥", exact: true })
			.first()
			.click();
		const editor = page.getByRole("dialog", {
			name: editing ? "编辑接口密钥" : "创建接口密钥",
			exact: true,
		});
		if (!editing) await editor.getByRole("textbox", { name: "代理名称", exact: true }).fill(name);
		const expiry = editor.getByLabel("到期时间", { exact: true });
		await expiry.fill("2099-12-01T10:30");
		await expiry.focus();
		await expiry.press("Backspace");
		expect(
			await expiry.evaluate((element: HTMLInputElement) => ({
				value: element.value,
				badInput: element.validity.badInput,
			})),
		).toEqual({ value: "", badInput: true });
		const mutations: string[] = [];
		page.on("request", (request) => {
			if (
				["POST", "PATCH"].includes(request.method()) &&
				new URL(request.url()).pathname.startsWith("/api/admin/keys")
			)
				mutations.push(request.method());
		});
		await editor
			.getByRole("button", { name: editing ? "保存修改" : "创建密钥", exact: true })
			.click();
		await expect
			.poll(
				async () => !(await editor.isVisible()) || (await editor.getByRole("alert").count()) > 0,
			)
			.toBe(true);
		const accidentalReveal = page.getByRole("dialog", { name: "请立即复制密钥", exact: true });
		if (await accidentalReveal.isVisible())
			await accidentalReveal.getByRole("button", { name: "关闭", exact: true }).click();
		expect(mutations).toEqual([]);
		await expect(expiry).toHaveAttribute("aria-invalid", "true");
		await expect(
			editor.getByText("请填写有效的到期时间，或留空表示永不过期。", { exact: true }),
		).toBeVisible();
		await capture(page, info, `keys-form-expiry-error-${editing ? "edit" : "create"}`);
		if (created)
			expect(await admin.json(`/keys/${created.key.id}`)).toMatchObject({
				expires_at: originalExpiry,
			});
		await expiry.fill("2099-12-01T10:30");
		await expiry.fill("");
		expect(await expiry.evaluate((element: HTMLInputElement) => element.validity.badInput)).toBe(
			false,
		);
		const submitted = page.waitForRequest(
			(request) =>
				["POST", "PATCH"].includes(request.method()) &&
				new URL(request.url()).pathname.startsWith("/api/admin/keys"),
		);
		await editor
			.getByRole("button", { name: editing ? "保存修改" : "创建密钥", exact: true })
			.click();
		expect((await submitted).postDataJSON()).toMatchObject({ expires_at: null });
		if (created) {
			await expect(editor).not.toBeVisible();
			expect(await admin.json(`/keys/${created.key.id}`)).toMatchObject({ expires_at: null });
		} else {
			const reveal = page.getByRole("dialog", { name: "请立即复制密钥", exact: true });
			await expect.poll(() => reveal.isVisible()).toBe(true);
			await reveal.getByRole("button", { name: "关闭", exact: true }).click();
		}
	});
}
