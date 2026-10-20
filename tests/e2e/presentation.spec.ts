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
		await capture(page, info, path === "/keys" ? "keys-long-name" : "memories-long-title");
	}
});

test("memory view controls align and keep a required keyboard-operable selection", async ({
	page,
}) => {
	await page.goto("/memories");
	const filter = page.getByRole("button", { name: "展开或收起记忆筛选", exact: true });
	const modes = page.getByRole("radiogroup", { name: "显示方式", exact: true });
	const filterBox = await filter.boundingBox();
	const modeBox = await modes.getByRole("radio", { name: "列表", exact: true }).boundingBox();
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
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/memories");
	const size = await page.getByRole("combobox", { name: "每页条数", exact: true }).boundingBox();
	const next = await page.getByRole("button", { name: "下一页", exact: true }).boundingBox();
	expect(size?.y).toBeCloseTo(next?.y ?? -1, 0);
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme });
		await page.goto("/audit");
		const from = page.getByLabel("开始日期", { exact: true });
		const to = page.getByLabel("结束日期", { exact: true });
		expect((await from.boundingBox())?.y).toBeCloseTo((await to.boundingBox())?.y ?? -1, 0);
		await expect(from).toHaveCSS("color-scheme", colorScheme);
	}
});
