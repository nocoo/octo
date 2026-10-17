import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";
import { startGateway } from "./gateway";

test("embedding defaults, write-only masking, real connection test, and clear", async ({
	page,
	admin,
}, info) => {
	const secret = `l3-embedding-${randomUUID()}-abcd`;
	const gateway = await startGateway(secret);
	try {
		await page.goto("/settings/embedding");
		const model = page.getByRole("textbox", { name: "Model", exact: true });
		await expect(model).toHaveValue("text-embedding-3-small");
		await expect(page.getByRole("spinbutton", { name: "Dimensions", exact: true })).toHaveValue(
			"1536",
		);
		await expect(
			page.getByRole("switch", { name: "Backfill missing vectors", exact: true }),
		).not.toBeChecked();
		const replacement = page.getByLabel("Replacement API key", { exact: true });
		await expect(replacement).toHaveAttribute("type", "password");
		expect((await replacement.inputValue()) === "").toBe(true);
		await page.getByRole("textbox", { name: "Gateway URL", exact: true }).fill(gateway.url);
		await expect(replacement).toBeEditable();
		await replacement.evaluate((element, value) => {
			(element as HTMLInputElement).value = value;
			element.dispatchEvent(new Event("input", { bubbles: true }));
		}, secret);
		await page.getByRole("button", { name: "Save settings", exact: true }).click();
		await expect(page.getByRole("status").filter({ hasText: "Configured" })).toContainText("abcd");
		expect((await replacement.inputValue()) === "").toBe(true);
		await page.reload();
		await expect(page.getByRole("status").filter({ hasText: "Configured" })).toContainText("abcd");
		expect((await replacement.inputValue()) === "").toBe(true);
		const stored = await admin.response("/settings/embedding");
		const storedText = await stored.text();
		expect(storedText.includes(secret)).toBe(false);
		expect(JSON.parse(storedText)).toMatchObject({
			api_key_set: true,
			api_key_suffix: "abcd",
			backfill_enabled: false,
		});
		expect(
			await page.evaluate(
				(value) =>
					!document.documentElement.outerHTML.includes(value) &&
					!JSON.stringify(localStorage).includes(value) &&
					!JSON.stringify(sessionStorage).includes(value),
				secret,
			),
		).toBe(true);
		await page.getByRole("button", { name: "Test connection", exact: true }).click();
		await expect(page.getByText("Connected", { exact: true })).toBeVisible();
		expect(gateway.observations.length).toBeGreaterThan(0);
		for (const observation of gateway.observations)
			expect(observation).toMatchObject({
				authorized: true,
				userAgent: expect.stringMatching(/^octo\//),
				model: "text-embedding-3-small",
				path: "/v1/embeddings",
			});
		await capture(page, info, "embedding-masked-connection-tested");
		await page.getByRole("button", { name: "Clear saved key", exact: true }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Clear key", exact: true })
			.click();
		await expect(page.getByText("No API key configured", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Clear saved key", exact: true })).toBeDisabled();
		await page.reload();
		expect((await replacement.inputValue()) === "").toBe(true);
		await expect(page.getByText("No API key configured", { exact: true })).toBeVisible();
		const cleared = await admin.json<{ api_key_set: boolean; api_key_suffix: string | null }>(
			"/settings/embedding",
		);
		expect(cleared).toMatchObject({ api_key_set: false, api_key_suffix: null });
		await capture(page, info, "embedding-secret-cleared");
	} finally {
		await gateway.close();
	}
});
