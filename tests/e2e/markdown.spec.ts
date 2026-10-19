import { capture, expect, test } from "./fixtures";

test("Markdown reading typography stays scoped and contains wide content in both previews", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory(
		[
			"# 阅读排版 Reading",
			"中文正文与 English prose，保留 **强调**、~~删除线~~ 和 `inline code`。",
			"第二段阅读内容。[参考链接](https://example.com/reference)",
			"## 后续章节",
			"> 第一段引用\n>\n> 第二段引用",
			"3. 有序条目\n4. 嵌套列表\n   - 子条目",
			"| 名称 | 数量 |\n| :--- | ---: |\n| 示例 | 42 |",
			`\`\`\`js\nconst longValue = "${"abcdefghij".repeat(80)}";\n\`\`\``,
		].join("\n\n"),
	);
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			for (const view of ["reader", "editor"] as const) {
				await page.goto(`/memories/${memory.id}${view === "editor" ? "/edit?pane=preview" : ""}`);
				const prose = page.locator(".octo-markdown");
				await expect(prose).toHaveCSS("font-size", "18px");
				await expect(prose).toHaveCSS("line-height", "29.7px");
				await expect(prose).toHaveCSS("row-gap", "16px");
				const fonts = await prose.evaluate((element) => ({
					reader: getComputedStyle(element).fontFamily,
					body: getComputedStyle(document.body).fontFamily,
				}));
				expect(fonts.reader).toContain("Charter");
				expect(fonts.reader).toContain('"Songti SC"');
				expect(fonts.body).not.toContain("Charter");
				await expect(prose.locator("h1")).toHaveCSS("margin-block-start", "0px");
				await expect(prose.locator("h2")).toHaveCSS("margin-block-start", "12px");
				await expect(prose.locator("blockquote > p + p")).toHaveCSS("margin-block-start", "12px");
				await expect(prose.locator("li > ul")).toHaveCSS("margin-block-start", "12px");
				await expect(prose.getByRole("link", { name: "参考链接" })).toHaveCSS(
					"text-decoration-line",
					"underline",
				);
				await expect(prose.locator("p > code")).toHaveCSS("font-size", "16px");
				await expect(prose.locator("pre code")).toHaveCSS("font-size", "14px");
				await expect(prose.locator("pre")).toHaveCSS("overflow-x", "auto");
				await expect(prose.locator("pre")).toHaveCSS("overscroll-behavior-x", "contain");
				await expect(prose.locator("pre")).toHaveCSS("overscroll-behavior-y", "auto");
				expect(
					await prose
						.locator("pre")
						.evaluate((element) => element.scrollWidth > element.clientWidth),
				).toBe(true);
				expect(
					await prose.evaluate((element) => element.scrollWidth - element.clientWidth),
				).toBeLessThanOrEqual(1);
				await expect(prose.locator("th").last()).toHaveCSS("text-align", "right");
				await expect(prose.locator(".hljs-string")).toBeVisible();
				await capture(page, info, `markdown-reading-${view}-${width}-${colorScheme}`);
			}
		}
	}
});

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
