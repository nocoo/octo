import { capture, expect, test } from "./fixtures";

for (const path of [
	"/keys",
	"/search",
	"/spaces?q=empty-layout-no-match",
	"/tags?q=empty-layout-no-match",
	"/memories?q=empty-layout-no-match",
	"/trash",
	"/graph",
	"/timeline",
	"/settings",
	"/usage",
	"/audit",
]) {
	test(`fills the remaining desktop content area on ${path}`, async ({ page }, info) => {
		await page.route(
			/\/api\/admin\/(keys|memories|trash|usage|audit|embedding-profiles)(\?|$)/,
			(route) =>
				route.fulfill({ json: { items: [], next_cursor: null, total: 0, active_profile: null } }),
		);
		await page.goto(path);
		const empty = page.locator(".octo-empty--page");
		await expect(empty).toBeVisible();
		const geometry = await empty.evaluate((element) => {
			const bounds = (element.closest("td") ?? element).getBoundingClientRect();
			const island = element.closest(".octo-island");
			if (!island) throw new Error("Missing content island");
			const card = element.closest("[data-basalt-surface]");
			if (!card) throw new Error("Missing empty-state surface");
			const children = [...element.children].map((child) => child.getBoundingClientRect());
			const first = children[0];
			const last = children.at(-1);
			const tail = card.parentElement?.lastElementChild;
			if (!first || !last || !tail) throw new Error("Missing empty-state content");
			return {
				height: card.getBoundingClientRect().height,
				bottomGap: island.getBoundingClientRect().bottom - tail.getBoundingClientRect().bottom,
				inset: Number.parseFloat(getComputedStyle(island).paddingBottom),
				centerOffset: (first.top + last.bottom) / 2 - (bounds.top + bounds.bottom) / 2,
			};
		});
		expect(geometry.height).toBeGreaterThan(400);
		expect(Math.abs(geometry.bottomGap - geometry.inset)).toBeLessThan(3);
		expect(Math.abs(geometry.centerOffset)).toBeLessThan(3);
		await capture(page, info, "empty-desktop");
	});
}

test("keeps empty-state actions usable on narrow and short screens", async ({ page }, info) => {
	await page.route("**/api/admin/keys", (route) => route.fulfill({ json: { items: [] } }));
	for (const viewport of [
		{ width: 390, height: 640 },
		{ width: 1280, height: 480 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto("/keys");
		const empty = page.locator(".octo-empty--page");
		await expect(empty).toBeVisible();
		const action = empty.getByRole("button", { name: "创建密钥" });
		await action.scrollIntoViewIfNeeded();
		await expect(action).toBeInViewport({ ratio: 1 });
		const alignment = await empty.evaluate((element) => {
			const bounds = element.getBoundingClientRect();
			const island = element.closest(".octo-island")?.getBoundingClientRect();
			if (!island) throw new Error("Missing content island");
			return (bounds.left + bounds.right - island.left - island.right) / 2;
		});
		expect(Math.abs(alignment)).toBeLessThan(3);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			viewport.width,
		);
		await capture(page, info, `empty-${viewport.width}`);
		await action.click();
		await expect(page.getByRole("dialog", { name: "创建接口密钥", exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(action).toBeFocused();
	}
});

test("preserves populated table geometry and supports dark empty states", async ({
	page,
	admin,
}, info) => {
	const name = `empty-layout-${Date.now()}`;
	await admin.json("/keys", "POST", { name, role: "readonly" });
	await page.goto("/keys");
	const row = page.getByRole("row").filter({ hasText: name });
	await expect(row).toBeVisible();
	await expect(page.locator(".octo-empty--page")).toHaveCount(0);
	expect((await row.boundingBox())?.height).toBeLessThan(100);
	await page.route("**/api/admin/keys", (route) => route.fulfill({ json: { items: [] } }));
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await page.reload();
	await expect(page.locator(".octo-empty--page")).toBeVisible();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await capture(page, info, "empty-dark");
});
