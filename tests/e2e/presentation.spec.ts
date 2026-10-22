import { capture, expect, test } from "./fixtures";

test("record tables keep long names and all key columns inside the desktop rail", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory();
	const title = "K".repeat(390);
	await admin.json(
		`/memories/${memory.id}`,
		"PATCH",
		{ title },
		{ "If-Match": String(memory.version) },
	);
	const name = "Collection agent ".repeat(7);
	await admin.json("/keys", "POST", { name, role: "readonly" });
	await page.setViewportSize({ width: 1440, height: 1000 });
	for (const [path, label] of [
		["/memories", "记忆"],
		["/keys", "接口密钥"],
	] as const) {
		await page.goto(path);
		const table = page.getByRole("table", { name: label, exact: true });
		await expect(table).toBeVisible();
		await expect(
			table.getByText(path === "/keys" ? name.trim() : title.trim(), { exact: true }).first(),
		).toBeVisible();
		const geometry = await table.evaluate((element) => ({
			width: element.getBoundingClientRect().width,
			rail: element.parentElement?.clientWidth ?? 0,
		}));
		expect(geometry.width).toBeLessThanOrEqual(geometry.rail);
		if (path === "/memories") {
			const badgesFit = await table.locator("[data-tag-color]").evaluateAll((badges) =>
				badges.every((badge) => {
					const range = document.createRange();
					range.selectNodeContents(badge);
					return [...range.getClientRects()].every(
						(rect) => rect.right <= badge.getBoundingClientRect().right + 1,
					);
				}),
			);
			expect(badgesFit).toBe(true);
		}
		await capture(page, info, path === "/keys" ? "keys-long-name" : "memories-long-title");
	}
});

test("memory filter actions align and view controls keep keyboard-operable selection", async ({
	page,
}) => {
	await page.goto("/memories");
	const filter = page.getByRole("button", { name: "展开或收起记忆筛选", exact: true });
	const modes = page.getByRole("radiogroup", { name: "显示方式", exact: true });
	const filterBox = await filter.boundingBox();
	const modeBox = await page.getByRole("button", { name: "应用筛选", exact: true }).boundingBox();
	expect(filterBox).not.toBeNull();
	expect(modeBox).not.toBeNull();
	expect((filterBox?.y ?? 0) + (filterBox?.height ?? 0) / 2).toBeCloseTo(
		(modeBox?.y ?? 0) + (modeBox?.height ?? 0) / 2,
		0,
	);
	const list = modes.getByRole("radio", { name: "列表", exact: true });
	await list.click();
	await expect(list).toHaveAttribute("aria-checked", "true");
	await list.focus();
	await page.keyboard.press("ArrowRight");
	await expect(modes.getByRole("radio", { name: "卡片", exact: true })).toBeFocused();
	await page.keyboard.press("Space");
	await expect(page).toHaveURL(/view=cards/);
});

test("pagination aligns labels and controls while date filters follow the native theme", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/memories");
	await expect(page.getByRole("link", { name: memory.title, exact: true })).toBeVisible();
	await expect
		.poll(async () => {
			const size = await page
				.getByRole("combobox", { name: "每页条数", exact: true })
				.boundingBox();
			const next = await page.getByRole("button", { name: "下一页", exact: true }).boundingBox();
			return size && next ? size.y - next.y : Number.POSITIVE_INFINITY;
		})
		.toBeCloseTo(0, 0);
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme });
		await page.goto("/audit");
		const from = page.getByLabel("开始日期", { exact: true });
		const to = page.getByLabel("结束日期", { exact: true });
		expect((await from.boundingBox())?.y).toBeCloseTo((await to.boundingBox())?.y ?? -1, 0);
		await expect(from).toHaveCSS("color-scheme", colorScheme);
	}
});

test("audit virtualization reaches the last record with two-line timestamps", async ({
	page,
	admin,
}) => {
	for (let index = 0; index < 40; index++) await admin.json("/spaces");
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/audit?action=%2Fapi%2Fadmin%2Fspaces");
	const table = page.getByRole("table", { name: "审计记录", exact: true });
	await expect(table.locator("[data-audit-row]").first()).toBeVisible();
	const total = Number(await table.getAttribute("aria-rowcount"));
	expect(total).toBeGreaterThan(40);
	await page.getByLabel("可滚动的审计记录", { exact: true }).evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const last = table.locator(`[data-audit-row][aria-rowindex="${total}"]`);
	await expect(last).toBeInViewport({ ratio: 1 });
	await expect(table.locator('[data-audit-row][aria-rowindex="2"]')).toHaveCount(0);
});
