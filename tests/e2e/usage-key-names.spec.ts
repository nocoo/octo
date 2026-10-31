import { expect, test } from "./fixtures";

test("daily usage displays key names and short ids after deletion", async ({
	page,
	admin,
	request,
}) => {
	const credential = await admin.json<{ plaintext: string; key: { id: string } }>("/keys", "POST", {
		name: "用量名称验证助手",
		role: "readonly",
	});
	const response = await request.get("/api/v1/me", {
		headers: { Authorization: `Bearer ${credential.plaintext}` },
	});
	expect(response.ok()).toBe(true);
	expect((await request.get("/cdn-cgi/local/scheduled?format=json")).ok()).toBe(true);
	await page.goto(`/usage?key_id=${credential.key.id}`);
	const table = page.getByRole("table", { name: "每日用量表", exact: true });
	await expect(table.getByRole("link", { name: "用量名称验证助手", exact: true })).toBeVisible();
	await expect(table).not.toContainText(credential.key.id);
	await admin.json(`/keys/${credential.key.id}/revoke`, "POST");
	await admin.json(`/keys/${credential.key.id}`, "DELETE");
	await page.reload();
	await expect(
		table.getByRole("link", { name: credential.key.id.slice(0, 8), exact: true }),
	).toBeVisible();
	await expect(table).not.toContainText("用量名称验证助手");
});
