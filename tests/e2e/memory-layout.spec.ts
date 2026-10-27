import { capture, expect, test } from "./fixtures";
import { expectDesktopMemoryRailGeometry, expectStackedMemoryColumns } from "./layout-helpers";

test("short memory bodies fill the desktop rail beside a wider information sidebar", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory(
		"# Short note\n\nA short body should not leave an empty column.",
	);
	for (const height of [900, 1400]) {
		await page.setViewportSize({ width: 1440, height });
		await page.goto(`/memories/${memory.id}`);
		await expect(page.locator(".octo-memory-body")).toBeVisible();
		await expect(page.getByRole("heading", { name: "正文", exact: true })).toHaveCount(0);
		const metadata = page.locator(".octo-memory-reader > .octo-memory-meta");
		await expect(metadata.getByRole("group", { name: "类型", exact: true })).toHaveText("类型笔记");
		await expect(metadata.getByRole("group", { name: "标签", exact: true })).toContainText(
			"field-notes",
		);
		await expect(metadata.getByRole("group", { name: "标签", exact: true })).not.toContainText(
			"笔记",
		);
		await expectDesktopMemoryRailGeometry(page);
		await capture(page, info, `reader-fill-${height}`);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await expectStackedMemoryColumns(page);
});

test("reader protects the title and prose at intermediate widths and navigates its TOC", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory(
		`# Reading notes\n\n${"A readable paragraph with useful context.\n\n".repeat(40)}## Final section\n\nThe destination remains visible.\n`,
	);
	const title = "Dashboard review: layouts, feedback and knowledge navigation";
	await admin.json(
		`/memories/${memory.id}`,
		"PATCH",
		{ title },
		{ "If-Match": String(memory.version) },
	);
	for (const width of [390, 768, 820, 1024, 1100, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`/memories/${memory.id}`);
		const heading = page.getByRole("heading", { name: title, exact: true });
		await expect(heading).toBeVisible();
		await expect
			.poll(async () => {
				const reader = await page.locator(".octo-memory-reader").boundingBox();
				const prose = await page.locator(".octo-markdown").boundingBox();
				const headingBox = await heading.boundingBox();
				if (!reader || !prose || !headingBox) return false;
				const proseMin = Math.min(400, reader.width - 32) - 1;
				return (
					prose.width >= proseMin &&
					headingBox.x >= reader.x &&
					headingBox.x + headingBox.width <= reader.x + reader.width + 1
				);
			})
			.toBe(true);
		expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
			true,
		);
		const header = page.locator(".octo-memory-reader .octo-page-header");
		await expect(header.getByRole("link", { name: "版本历史", exact: true })).toBeVisible();
		await expect(header.getByRole("link", { name: "编辑记忆", exact: true })).toBeVisible();
		if (width === 768) await capture(page, info, "reader-intermediate-width");
	}
	await page.setViewportSize({ width: 390, height: 650 });
	const opener = page.getByRole("button", { name: "本页目录", exact: true });
	await opener.click();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).not.toBeVisible();
	await expect(opener).toBeFocused();
	for (let visit = 0; visit < 2; visit++) {
		await opener.click();
		await page
			.getByRole("dialog")
			.getByRole("link", { name: "Final section", exact: true })
			.click();
		await expect(page.getByRole("dialog")).not.toBeVisible();
		await expect(page.getByRole("heading", { name: "Final section", exact: true })).toBeInViewport({
			ratio: 1,
		});
	}
});

test("memory filters occupy the content rail and align fields independently of helper text", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		for (const path of ["/memories", `/search?q=${encodeURIComponent(memory.title)}`]) {
			await page.goto(path);
			if (path.startsWith("/search"))
				await page.getByRole("button", { name: "高级融合选项", exact: true }).click();
			await page.getByRole("button", { name: "展开或收起记忆筛选", exact: true }).click();
			const filters = page.getByRole("form", { name: "记忆筛选", exact: true });
			await expect(filters).toBeVisible();
			const widthRatio = await filters.evaluate((form) => {
				const island = document.querySelector(".octo-island");
				if (!island) throw new Error("Expected the application content island");
				// /search hosts the memory filters inside the search-options popover, so the
				// panel is the rail there; elsewhere the page band must fill the island.
				const panel =
					form.closest("[data-radix-popper-content-wrapper]") ?? form.closest(".z-50") ?? island;
				return form.getBoundingClientRect().width / panel.getBoundingClientRect().width;
			});
			expect(widthRatio).toBeGreaterThan(0.85);
			if (width === 1440) {
				await expect
					.poll(async () => {
						const start = await filters
							.getByLabel("起始时间（UTC）", { exact: true })
							.boundingBox();
						const importance = await filters
							.getByLabel("重要性下限", { exact: true })
							.boundingBox();
						if (!start || !importance) return Number.POSITIVE_INFINITY;
						return Math.abs(start.y - importance.y);
					})
					.toBeLessThan(0.5);
			}
		}
	}
	await page.goto(`/memories?spaces=${memory.space}`);
	await expect(page.getByRole("form", { name: "记忆筛选", exact: true })).toBeVisible();
	const row = page
		.getByRole("row")
		.filter({ has: page.getByRole("link", { name: memory.title, exact: true }) });
	await expect(row).toBeVisible();
	const box = await row.boundingBox();
	// a two-line title plus its type badge stays a compact row; card layouts are far taller
	expect(box?.height).toBeLessThan(96);
});

test("hidden invalid search options reopen with focus without dropping draft parameters", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/search");
	await page.getByRole("textbox", { name: "搜索记忆", exact: true }).fill(memory.title);
	const disclosure = page.getByRole("button", { name: "高级融合选项", exact: true });
	await disclosure.click();
	const k = page.getByRole("spinbutton", { name: "RRF 参数 k", exact: true });
	await k.fill("0");
	await page.getByRole("spinbutton", { name: "向量权重", exact: true }).fill("2.5");
	await disclosure.click();
	await expect(k).not.toBeVisible();
	const searches: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().endsWith("/api/admin/search"))
			searches.push(request.postData() ?? "");
	});
	await page.getByRole("main").getByRole("button", { name: "搜索", exact: true }).click();
	await expect(k).toBeFocused();
	await expect(k).toHaveAttribute("aria-invalid", "true");
	await expect(k).toHaveValue("0");
	expect(searches).toHaveLength(0);
	await k.fill("60");
	await disclosure.click();
	const submitted = page.waitForRequest(
		(request) => request.method() === "POST" && request.url().endsWith("/api/admin/search"),
	);
	await page.getByRole("main").getByRole("button", { name: "搜索", exact: true }).click();
	expect((await submitted).postDataJSON()).toMatchObject({
		query: memory.title,
		fusion: { k: 60, weights: { vector: 2.5 } },
	});
	await expect(page.getByRole("link", { name: memory.title, exact: true })).toBeVisible();
});

test("editor labels and same-row fields remain aligned", async ({ page, admin }) => {
	const memory = await admin.memory();
	await page.goto(`/memories/${memory.id}/edit`);
	await expect(page.getByRole("textbox", { name: "Markdown 正文", exact: true })).toHaveValue(
		memory.body,
	);
	const labels = await page.locator("main label").evaluateAll((elements) =>
		elements.map((element) => ({
			label: element.textContent,
			linked: Boolean(document.getElementById((element as HTMLLabelElement).htmlFor)),
		})),
	);
	for (const label of labels) expect(label.linked, label.label ?? "Field label").toBe(true);
	await expect
		.poll(async () => {
			const space = await page.getByLabel("空间", { exact: true }).boundingBox();
			const event = await page.getByLabel("事件时间（UTC）", { exact: true }).boundingBox();
			if (!space || !event) return Number.POSITIVE_INFINITY;
			return Math.abs(event.y - space.y);
		})
		.toBeLessThan(0.5);
});

for (const width of [390, 1440]) {
	test(`save and upload failures remain visible from the editor bottom at ${width}px`, async ({
		page,
		admin,
	}, info) => {
		const memory = await admin.memory(`# Long draft\n\n${"Context and notes.\n\n".repeat(80)}`);
		await page.setViewportSize({ width, height: 650 });
		await page.route(`**/api/admin/memories/${memory.id}`, async (route) => {
			if (route.request().method() === "PATCH")
				await route.fulfill({ status: 503, json: { error: { code: "unavailable" } } });
			else await route.continue();
		});
		await page.route(`**/api/admin/memories/${memory.id}/attachments`, async (route) => {
			if (route.request().method() === "POST")
				await route.fulfill({ status: 503, json: { error: { code: "unavailable" } } });
			else await route.continue();
		});
		await page.goto(`/memories/${memory.id}/edit`);
		const body = page.getByRole("textbox", { name: "Markdown 正文", exact: true });
		const draft = `${memory.body}\nAn unsaved change.`;
		await body.fill(draft);
		await page.locator(".octo-island").evaluate((island) => {
			island.scrollTop = island.scrollHeight;
			window.scrollTo(0, document.documentElement.scrollHeight);
		});
		await page.keyboard.press("Control+s");
		const notice = page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "服务暂不可用，请稍后重试。" });
		await expect(notice).toBeInViewport({ ratio: 1 });
		await expect(page.getByRole("main").getByRole("alert")).toContainText("服务暂不可用");
		await capture(page, info, `editor-save-error-${width}`);
		await page.locator('input[type="file"]').setInputFiles({
			name: "failed-upload.pdf",
			mimeType: "application/pdf",
			buffer: Buffer.from("%PDF-1.4\n%%EOF"),
		});
		await expect(notice).toBeInViewport({ ratio: 1 });
		await expect(body).toHaveValue(draft);
		expect(await admin.json(`/memories/${memory.id}`)).toMatchObject({
			body: memory.body,
			version: memory.version,
		});
	});
}

test("long history strings wrap instead of disappearing behind their card", async ({
	page,
	admin,
}, info) => {
	const memory = await admin.memory();
	const title = `${"B".repeat(240)} END-OF-TITLE`;
	await admin.json(
		`/memories/${memory.id}`,
		"PATCH",
		{ title },
		{ "If-Match": String(memory.version) },
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/memories/${memory.id}/history?from=1&to=2`);
	const value = page.locator(".octo-memory-value").filter({ hasText: "END-OF-TITLE" });
	await expect(value).toHaveText(title);
	expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
		true,
	);
	await value.scrollIntoViewIfNeeded();
	await expect(value).toBeInViewport();
	const clippedPixels = await value.evaluate(
		(element) =>
			new Promise<number>((resolve) => {
				const observer = new IntersectionObserver(([entry]) => {
					if (!entry) return;
					const bounds = entry.boundingClientRect;
					const visible = entry.intersectionRect;
					observer.disconnect();
					resolve(
						Math.max(
							visible.left - bounds.left,
							bounds.right - visible.right,
							visible.top - bounds.top,
							bounds.bottom - visible.bottom,
						),
					);
				});
				observer.observe(element);
			}),
	);
	expect(clippedPixels).toBeLessThanOrEqual(1);
	await capture(page, info, "history-long-value-wrapped");
});
