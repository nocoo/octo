import { capture, expect, test } from "./fixtures";

test("Unicode attachment upload persists through the editor and signed R2 download", async ({
	page,
	admin,
	request,
}, info) => {
	const memory = await admin.memory();
	const filename = "结构图.svg";
	const body =
		'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0h16v16H0z"/></svg>';
	await page.goto(`/memories/${memory.id}/edit`);
	const editor = page.getByRole("textbox", { name: "Markdown 正文", exact: true });
	await expect(editor).toHaveValue(memory.body);
	await page
		.locator('input[type="file"]')
		.setInputFiles({ name: filename, mimeType: "image/svg+xml", buffer: Buffer.from(body) });
	await expect(editor).toHaveValue(new RegExp(`\\[${filename}\\]\\(octo://att/`));
	await page.getByRole("button", { name: "保存记忆", exact: true }).click();
	await expect(page.getByText("已保存第 2 版", { exact: true })).toBeVisible();
	const attachments = await admin.json<{ items: { id: string; filename: string }[] }>(
		`/memories/${memory.id}/attachments`,
	);
	expect(attachments.items).toHaveLength(1);
	expect(attachments.items[0]?.filename).toBe(filename);
	const signed = await admin.json<{ url: string }>(`/attachments/${attachments.items[0]?.id}/url`);
	expect(new URL(signed.url).origin).toBe("http://127.0.0.1:27059");
	const download = await request.get(signed.url);
	expect(download.status()).toBe(200);
	expect(download.headers()["content-disposition"]).toContain("attachment");
	expect(await download.text()).toBe(body);
	await page.goto(`/memories/${memory.id}`);
	await expect(page.getByRole("link", { name: filename, exact: true }).first()).toBeVisible();
	await expect(page.getByRole("alert")).toHaveCount(0);
	await capture(page, info, "memory-unicode-attachment");
});
