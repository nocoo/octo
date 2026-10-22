import { capture, expect, test } from "./fixtures";

test("invalid hidden memory filters reopen before native validation focuses the field", async ({
	page,
}) => {
	await page.goto("/memories");
	const trigger = page.getByRole("button", { name: "展开或收起记忆筛选" });
	await trigger.click();
	const minimum = page.getByRole("spinbutton", { name: "重要性下限", exact: true });
	await minimum.fill("2");
	await trigger.click();
	await page.getByRole("button", { name: "应用筛选", exact: true }).click();
	await expect(minimum).toBeVisible();
	await expect(minimum).toBeFocused();
	expect(new URL(page.url()).search).toBe("");
});

test("memory filters keep drafts separate and preserve collapsed advanced parameters", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory();
	const query = new URLSearchParams({
		spaces: memory.space,
		types: "note",
		tags_all: "l3",
		tags_any: "field-notes",
		time_field: "created",
		time_from: "2020-01-01T00:00:00.001Z",
		importance_min: "0",
		importance_max: "1",
		selected: memory.id,
		view: "cards",
	});
	await page.goto(`/memories?${query}`);
	const form = page.getByRole("form", { name: "记忆筛选", exact: true });
	const advanced = page.getByRole("group", { name: "更多记忆筛选", exact: true });
	await expect(advanced).toBeVisible();
	await expect(page.getByRole("button", { name: "清除类型筛选", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "展开或收起记忆筛选" }).click();
	await expect(advanced).not.toBeVisible();
	await form.getByRole("button", { name: "类型", exact: true }).click();
	await page.getByRole("option", { name: "事件", exact: true }).click();
	await page.keyboard.press("Escape");
	expect(new URL(page.url()).searchParams.get("types")).toBe("note");
	await form.getByRole("button", { name: "应用筛选", exact: true }).click();
	await expect(page).toHaveURL(/types=note%2Cevent/);
	const applied = new URL(page.url()).searchParams;
	for (const name of [
		"spaces",
		"tags_all",
		"tags_any",
		"time_field",
		"time_from",
		"importance_min",
		"importance_max",
		"view",
	])
		expect(applied.get(name)).toBe(query.get(name));
	expect(applied.has("selected")).toBe(false);
	await page.getByRole("button", { name: "清除包含全部标签筛选", exact: true }).click();
	await expect.poll(() => new URL(page.url()).searchParams.has("tags_all")).toBe(false);
	await expect(page.getByRole("button", { name: "清除包含全部标签筛选", exact: true })).toHaveCount(
		0,
	);
	await expect(advanced).not.toBeVisible();
	expect(new URL(page.url()).searchParams.get("tags_any")).toBe("field-notes");
	await capture(page, info, "memory-applied-filters");
});

test("space choices search names and identifiers, retain freeform selections and clear individually", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.goto("/memories");
	const form = page.getByRole("form", { name: "记忆筛选", exact: true });
	await form.getByRole("button", { name: "空间", exact: true }).click();
	const query = page.getByPlaceholder("搜索或输入标识", { exact: true });
	await query.fill(memory.space.replace("l3-", "L3 "));
	await expect(page.getByRole("option")).toHaveCount(1);
	await query.fill(memory.space);
	await page.getByRole("option").filter({ hasText: memory.space }).click();
	await query.fill("custom-unknown-space");
	await page.getByRole("option", { name: "custom-unknown-space", exact: true }).click();
	await page.keyboard.press("Escape");
	await form.getByRole("button", { name: "应用筛选", exact: true }).click();
	await expect(page).toHaveURL(/custom-unknown-space/);
	await expect(form.getByRole("button", { name: "空间", exact: true })).toContainText("已选 2 项");
	await page.reload();
	await expect(form.getByRole("button", { name: "空间", exact: true })).toContainText("已选 2 项");
	await page.getByRole("button", { name: "清除空间筛选", exact: true }).click();
	await expect.poll(() => new URL(page.url()).searchParams.has("spaces")).toBe(false);
});

test("search mode stays visible and submits with the external search form", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.goto("/search");
	await expect(page.getByRole("form", { name: "搜索选项" })).not.toBeVisible();
	await page.getByRole("combobox", { name: "搜索模式", exact: true }).click();
	await page.getByRole("option", { name: "全文搜索", exact: true }).click();
	await page.getByRole("textbox", { name: "搜索记忆", exact: true }).fill(memory.title);
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	await expect(page).toHaveURL(/mode=fts/);
	await expect(page.getByRole("link", { name: memory.title, exact: true })).toBeVisible();
});
