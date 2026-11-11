import { expect, test } from "./fixtures";
import { accessHeaders } from "./setup";

test("loads the public sidebar identity once across SPA navigation", async ({ page, context }) => {
	await context.setExtraHTTPHeaders(await accessHeaders("architie@gmail.com"));
	const identityRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/api/admin/whoami")
			identityRequests.push(request.url());
	});
	const response = page.waitForResponse(
		(result) => new URL(result.url()).pathname === "/api/admin/whoami",
	);
	await page.goto("/settings");
	const identityResponse = await response;
	expect(identityResponse.ok()).toBe(true);
	const identity = await identityResponse.json();
	expect(identity).toMatchObject({ email: "architie@gmail.com", name: "Zheng Li" });
	expect(identity.avatar).toMatch(/^data:image\/png;base64,/);
	const sidebar = page.locator("[data-basalt-sidebar]");
	await expect(sidebar.getByText("octo", { exact: true })).toBeVisible();
	const footer = sidebar.locator('[data-slot="sidebar-footer"]');
	await expect(footer.getByText("Zheng Li", { exact: true })).toBeVisible();
	await expect(footer.getByText("architie@gmail.com", { exact: true })).toBeVisible();
	const avatar = footer.getByRole("img", { name: "Zheng Li", exact: true });
	const avatarImage = avatar.locator("img");
	await expect(avatarImage).toBeVisible();
	await expect(avatarImage).toHaveAttribute("src", identity.avatar);
	await expect(avatarImage).toHaveAttribute("alt", "Zheng Li 的头像");
	await expect(avatarImage).toHaveAttribute("referrerpolicy", "no-referrer");
	await expect(avatar).toHaveCSS("width", "36px");
	await expect(avatar).toHaveCSS("height", "36px");
	await expect(footer.getByRole("link", { name: "退出登录", exact: true })).toBeVisible();
	expect(
		await avatarImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
	).toBeGreaterThan(0);
	await expect(avatar.locator(":scope > span")).toHaveCount(0);
	for (const [label, path] of [
		["记忆库", "/memories"],
		["向量模型", "/settings/embedding"],
		["设置", "/settings"],
	] as const) {
		await sidebar.getByRole("button", { name: label, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`${path}$`));
		await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
		await expect(avatarImage).toBeVisible();
	}
	await sidebar.getByRole("button", { name: "收起侧栏", exact: true }).click();
	await expect(footer.locator('[role="img"]')).toHaveAccessibleName(
		"Zheng Li · architie@gmail.com",
	);
	await expect(
		footer.getByRole("img", { name: "Zheng Li · architie@gmail.com", exact: true }),
	).toBeVisible();
	expect(identityRequests).toHaveLength(1);
	await page.reload();
	await expect(
		page
			.locator('[data-slot="sidebar-footer"]')
			.getByRole("img", { name: "Zheng Li", exact: true })
			.locator("img"),
	).toBeVisible();
	expect(identityRequests).toHaveLength(2);
});

test("keeps verified email and initials when the public profile is null", async ({
	page,
	context,
}) => {
	await context.setExtraHTTPHeaders(await accessHeaders("l3-null@local"));
	const response = page.waitForResponse(
		(result) => new URL(result.url()).pathname === "/api/admin/whoami",
	);
	await page.goto("/settings");
	const identityResponse = await response;
	expect(identityResponse.ok()).toBe(true);
	expect(await identityResponse.json()).toEqual({
		email: "l3-null@local",
		actor: "admin:l3-null@local",
		name: null,
		avatar: null,
	});
	const footer = page.locator('[data-slot="sidebar-footer"]');
	await expect(footer.getByText("l3-null@local", { exact: true })).toBeVisible();
	const avatar = footer.getByRole("img", { name: "l3-null", exact: true });
	await expect(avatar).toHaveText("L3");
	await expect(avatar.locator("img")).toHaveCount(0);
});

test("uses the native Basalt fallback when a public avatar cannot decode", async ({
	page,
	context,
}) => {
	await context.setExtraHTTPHeaders(await accessHeaders("l3-broken@local"));
	const response = page.waitForResponse(
		(result) => new URL(result.url()).pathname === "/api/admin/whoami",
	);
	await page.goto("/settings");
	const identityResponse = await response;
	expect(identityResponse.ok()).toBe(true);
	const identity = await identityResponse.json();
	expect(identity).toMatchObject({ email: "l3-broken@local", name: "Zheng Li" });
	expect(identity.avatar).toMatch(/^data:image\/png;base64,/);
	expect(
		await page.evaluate(async (source: string) => {
			const image = new Image();
			image.src = source;
			return image.decode().then(
				() => true,
				() => false,
			);
		}, identity.avatar),
	).toBe(false);
	const footer = page.locator('[data-slot="sidebar-footer"]');
	await expect(footer.getByText("Zheng Li", { exact: true })).toBeVisible();
	await expect(footer.getByText("l3-broken@local", { exact: true })).toBeVisible();
	const avatar = footer.getByRole("img", { name: "Zheng Li", exact: true });
	await expect(avatar).toHaveText("ZL");
	await expect(avatar.locator("img")).toHaveCount(0);
	await expect(avatar).toHaveAccessibleName("Zheng Li");
});
