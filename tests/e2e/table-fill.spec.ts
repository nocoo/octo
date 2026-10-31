import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function expectDesktopTable(
	page: Page,
	table: Locator,
	scroll: Locator,
	pager?: Locator,
): Promise<void> {
	await expect(table).toBeVisible();
	await expect
		.poll(() =>
			table.evaluate((element) => {
				const card = element.closest("[data-basalt-surface]");
				const island = element.closest(".octo-island");
				if (!card || !island) throw new Error("Missing table surface");
				return {
					fills: card.getBoundingClientRect().bottom > 790,
					contained: card.getBoundingClientRect().bottom <= island.getBoundingClientRect().bottom,
					islandScrolls: island.scrollHeight > island.clientHeight + 1,
					pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
				};
			}),
		)
		.toEqual({ fills: true, contained: true, islandScrolls: false, pageScrolls: false });
	await expect
		.poll(() => scroll.evaluate((element) => element.scrollHeight - element.clientHeight))
		.toBeGreaterThan(50);
	await scroll.evaluate((element) => {
		element.scrollTop = 0;
	});
	const header = table.getByRole("columnheader").first();
	const headerTop = await header.evaluate((element) => element.getBoundingClientRect().top);
	await scroll.focus();
	await scroll.press("PageDown");
	await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await scroll.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect
		.poll(() =>
			header.evaluate(
				(element, top) => Math.abs(element.getBoundingClientRect().top - top),
				headerTop,
			),
		)
		.toBeLessThanOrEqual(1);
	await expect(header).toBeInViewport({ ratio: 1 });
	if (pager) await expect(pager).toBeInViewport({ ratio: 1 });
	await expect(page.locator(".octo-page-header")).toBeInViewport({ ratio: 1 });
}

for (const route of ["memories", "trash"] as const) {
	test(`${route} fills desktop height, scrolls locally and keeps real pagination usable`, async ({
		page,
		admin,
	}) => {
		test.setTimeout(120_000);
		const seed = await admin.memory();
		for (let index = 0; index < 26; index++) {
			const memory = await admin.json<{ id: string }>("/memories", "POST", {
				space: seed.space,
				title: `Table fill ${route} ${index}`,
				body: "Real local table layout fixture.",
				type: "note",
				tags: [],
			});
			if (route === "trash") await admin.json(`/memories/${memory.id}`, "DELETE");
		}
		const path =
			route === "memories"
				? `/memories?spaces=${seed.space}&limit=20`
				: `/trash?space=${seed.space}`;
		const name = route === "memories" ? "记忆" : "回收站中的记忆";
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(path);
		const table = page.getByRole("table", { name, exact: true });
		const scroll = page.getByRole("region", {
			name: route === "memories" ? "可滚动的记忆" : `${name} scroll area`,
			exact: true,
		});
		const next = page.getByRole("button", { name: "下一页", exact: true });
		await expectDesktopTable(page, table, scroll, next);
		await expect
			.poll(() =>
				table
					.locator("tbody tr")
					.last()
					.evaluate((element) => {
						const viewport = element.closest('[role="region"]');
						if (!viewport) throw new Error("Missing row scroll viewport");
						const row = element.getBoundingClientRect();
						const bounds = viewport.getBoundingClientRect();
						return Math.max(
							bounds.top - row.top,
							row.bottom - bounds.bottom,
							bounds.left - row.left,
							row.right - bounds.right,
						);
					}),
			)
			.toBeLessThanOrEqual(1);
		const firstPage = await table.locator("tbody").textContent();
		await next.click();
		await expect(table.locator("tbody")).not.toHaveText(firstPage ?? "");
		await expect(next).toBeDisabled();
		await expect(next).toBeInViewport({ ratio: 1 });
		await page.setViewportSize({ width: 390, height: 640 });
		await page.goto(path);
		await expect(table).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollHeight))
			.toBeGreaterThan(640);
		await expect
			.poll(() => scroll.evaluate((element) => element.scrollHeight - element.clientHeight))
			.toBeLessThanOrEqual(1);
		await next.scrollIntoViewIfNeeded();
		await expect(next).toBeInViewport({ ratio: 1 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			390,
		);
	});
}

test("spaces keeps the Basalt pager fixed while rows scroll and filter to empty", async ({
	page,
	admin,
}) => {
	test.setTimeout(120_000);
	const prefix = `table-fill-${randomUUID()}`;
	for (let index = 0; index < 26; index++) {
		await admin.json("/spaces", "POST", { slug: `${prefix}-${index}`, name: `${prefix} ${index}` });
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/spaces?q=${prefix}`);
	const table = page.getByRole("table", { name: "空间", exact: true });
	const next = page.getByRole("button", { name: "Next page", exact: true });
	await expectDesktopTable(
		page,
		table,
		page.getByRole("region", { name: "空间 scroll area", exact: true }),
		next,
	);
	await next.click();
	await expect(table.locator("tbody tr")).toHaveCount(1);
	await expect(next).toBeDisabled();
	await page.getByRole("textbox", { name: "筛选空间", exact: true }).fill(`${prefix}-missing`);
	const empty = page.locator(".octo-empty--page");
	await expect(empty).toBeVisible();
	const geometry = await empty.evaluate((element) => {
		const cell = element.closest("td");
		const card = element.closest("[data-basalt-surface]");
		if (!cell || !card || !element.firstElementChild || !element.lastElementChild)
			throw new Error("Missing empty table geometry");
		return {
			height: card.getBoundingClientRect().height,
			offset:
				(element.firstElementChild.getBoundingClientRect().top +
					element.lastElementChild.getBoundingClientRect().bottom -
					cell.getBoundingClientRect().top -
					cell.getBoundingClientRect().bottom) /
				2,
		};
	});
	expect(geometry.height).toBeGreaterThan(400);
	expect(Math.abs(geometry.offset)).toBeLessThan(3);
	await expect(next).toBeInViewport({ ratio: 1 });
});

test("keys, usage charts and virtual audit retain viewport tables with real API activity", async ({
	page,
	admin,
}) => {
	test.setTimeout(120_000);
	const prefix = `table-fill-${randomUUID()}`;
	for (let index = 0; index < 26; index++) {
		const key = await admin.json<{ plaintext: string }>("/keys", "POST", {
			name: `${prefix}-${index}`,
			role: "readonly",
		});
		const response = await page.request.get("/api/v1/me", {
			headers: { Authorization: `Bearer ${key.plaintext}` },
			maxRedirects: 0,
		});
		expect(response.status()).toBe(200);
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	for (const [path, name, scrollName] of [
		["/keys", "接口密钥", "接口密钥 scroll area"],
		["/usage", "每日用量表", "每日用量表 scroll area"],
		["/audit?action=%2Fapi%2Fv1%2Fme", "审计记录", "可滚动的审计记录"],
	] as const) {
		await page.goto(path);
		const table = page.getByRole("table", { name, exact: true });
		await expectDesktopTable(
			page,
			table,
			page.getByRole("region", { name: scrollName, exact: true }),
			path === "/keys" ? undefined : page.getByRole("button", { name: "加载更多", exact: true }),
		);
		if (path === "/usage") {
			const plots = page.locator(".octo-table-charts .ops-plot");
			await expect(plots).toHaveCount(2);
			for (const plot of await plots.all()) {
				await expect(plot).toBeInViewport({ ratio: 1 });
				expect((await plot.boundingBox())?.height).toBeGreaterThanOrEqual(190);
			}
		}
		if (name === "审计记录") {
			const total = Number(await table.getAttribute("aria-rowcount"));
			await expect(table.locator(`[data-audit-row][aria-rowindex="${total}"]`)).toBeInViewport({
				ratio: 1,
			});
			expect(await table.locator("[data-audit-row]").count()).toBeLessThan(total - 1);
		}
	}
});
