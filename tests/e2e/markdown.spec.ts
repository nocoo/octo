import { capture, expect, test } from "./fixtures";

test("Markdown lists retain markers, numbering, nesting and task controls", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory(
		"# 列表检查\n\n- 普通条目\n  - 嵌套条目\n\n3. 第三项\n4. 第四项\n\n- [x] 已完成条目\n- [ ] 未完成条目\n- 同列表中的普通条目\n",
	);
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			for (const view of ["reader", "editor"] as const) {
				await page.goto(`/memories/${memory.id}${view === "editor" ? "/edit?pane=preview" : ""}`);
				const prose = page.locator(".octo-markdown");
				const unordered = prose.locator("ul:not(.contains-task-list)").first();
				const nested = unordered.locator("ul");
				const ordered = prose.locator("ol");
				await expect(unordered).toHaveCSS("list-style-type", "disc");
				await expect(nested).toHaveCSS("list-style-type", "disc");
				await expect(ordered).toHaveCSS("list-style-type", "decimal");
				await expect(ordered).toHaveAttribute("start", "3");
				for (const list of [unordered, nested, ordered]) {
					expect(
						await list.evaluate((element) =>
							Number.parseFloat(getComputedStyle(element).paddingInlineStart),
						),
					).toBeGreaterThan(0);
				}
				const outerBox = await unordered.boundingBox();
				const nestedBox = await nested.boundingBox();
				expect(nestedBox?.x).toBeGreaterThan(outerBox?.x ?? Number.POSITIVE_INFINITY);
				await expect(prose.locator(".task-list-item").first()).toHaveCSS("list-style-type", "none");
				await expect(prose.locator(".contains-task-list > li:not(.task-list-item)")).toHaveCSS(
					"list-style-type",
					"disc",
				);
				await expect(
					prose.getByRole("checkbox", { name: "已完成任务", exact: true }),
				).toBeChecked();
				await expect(
					prose.getByRole("checkbox", { name: "未完成任务", exact: true }),
				).not.toBeChecked();
				await expect(prose.getByRole("checkbox").first()).toBeDisabled();
				await capture(page, info, `markdown-lists-${view}-${width}-${colorScheme}`);
			}
		}
	}
});
