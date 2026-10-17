import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";

test("mint once, copy, close, refresh, and revoke a real API key", async ({
	page,
	context,
	admin,
}, info) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const name = `L3 agent ${randomUUID()}`;
	await page.goto("/keys");
	await page.getByRole("button", { name: "Create key", exact: true }).click();
	const create = page.getByRole("dialog", { name: "Create API key", exact: true });
	await create.getByRole("textbox", { name: "Agent name", exact: true }).fill(name);
	await create.getByRole("button", { name: "Create key", exact: true }).click();
	const reveal = page.getByRole("dialog", { name: "Copy your key now", exact: true });
	await expect(reveal).toBeVisible();
	const secret = await reveal.getByRole("textbox", { name: "API key", exact: true }).inputValue();
	expect(secret.startsWith("octo_")).toBe(true);
	try {
		await reveal.getByRole("button", { name: "Copy key", exact: true }).click();
		expect(
			await page.evaluate(
				async (value) => (await navigator.clipboard.readText()) === value,
				secret,
			),
		).toBe(true);
		await reveal.getByRole("button", { name: "Close and clear", exact: true }).click();
		await expect(reveal).not.toBeVisible();
		await page.reload();
		await expect(page.getByRole("row").filter({ hasText: name })).toContainText("active");
		expect(
			await page.evaluate(
				(value) =>
					!document.documentElement.outerHTML.includes(value) &&
					!Array.from(document.querySelectorAll("input")).some((input) =>
						input.value.includes(value),
					) &&
					!JSON.stringify(localStorage).includes(value) &&
					!JSON.stringify(sessionStorage).includes(value),
				secret,
			),
		).toBe(true);
		const listed = await admin.response("/keys");
		expect((await listed.text()).includes(secret)).toBe(false);
		const accepted = await page.request.get("/api/v1/me", {
			headers: { Authorization: `Bearer ${secret}` },
			maxRedirects: 0,
		});
		expect(accepted.status()).toBe(200);
		await page.getByRole("button", { name: `Revoke ${name}`, exact: true }).click();
		await page.getByRole("button", { name: "Revoke key", exact: true }).click();
		await expect(page.getByRole("row").filter({ hasText: name })).toContainText("revoked");
		const rejected = await page.request.get("/api/v1/me", {
			headers: { Authorization: `Bearer ${secret}` },
			maxRedirects: 0,
		});
		expect(rejected.status()).toBe(401);
		await capture(page, info, "keys-revoked-secret-cleared");
	} finally {
		await page.evaluate(() => navigator.clipboard.writeText(""));
	}
});
