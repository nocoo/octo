import { expect, test } from "./fixtures";

for (const view of ["usage", "audit"] as const) {
	test(`${view} keeps drafts separate and removes applied conditions without changing remaining times`, async ({
		page,
	}) => {
		const applied =
			view === "audit"
				? {
						actor: "filter-probe",
						action: "/api/admin/spaces",
						status: "403",
						from: "2026-10-01T08:30:00+08:00",
						to: "2026-10-17T18:45:00Z",
					}
				: { key_id: "filter-probe", from: "2026-10-01", to: "2026-10-17" };
		const labels: Record<string, string> = {
			actor: "调用者",
			action: "路由模板",
			status: "状态码",
			key_id: "密钥标识",
			from: "开始日期",
			to: "结束日期",
		};
		const path = `/${view}?${new URLSearchParams(applied)}`;
		const filterName = view === "audit" ? "审计筛选" : "用量筛选";
		const openFilters = async () => {
			const group = page.getByRole("group", { name: filterName, exact: true });
			if (!(await group.isVisible().catch(() => false)))
				await page.getByRole("button", { name: filterName, exact: true }).click();
			return group;
		};
		await page.setViewportSize({ width: 390, height: 844 });
		for (const key of Object.keys(applied)) {
			await page.goto(path);
			const bar = await openFilters();
			await expect(
				bar.getByRole("button", { name: `移除${labels[key]}筛选`, exact: true }),
			).toBeVisible();
			await bar
				.getByLabel(view === "audit" ? "调用者" : "密钥标识", { exact: true })
				.fill("unsubmitted-draft");
			await expect(page).toHaveURL(new URL(path, "http://127.0.0.1:27059").href);
			await expect(bar).toContainText("filter-probe");
			await expect(bar.getByText("unsubmitted-draft", { exact: true })).toHaveCount(0);
			await bar.getByRole("button", { name: `移除${labels[key]}筛选`, exact: true }).click();
			const remaining = new URLSearchParams(applied);
			remaining.delete(key);
			await expect
				.poll(() => Object.fromEntries(new URL(page.url()).searchParams))
				.toEqual(Object.fromEntries(remaining));
			await expect(
				bar.getByRole("button", { name: `移除${labels[key]}筛选`, exact: true }),
			).toHaveCount(0);
			await expect(
				bar.getByLabel(view === "audit" ? "调用者" : "密钥标识", { exact: true }),
			).not.toHaveValue("unsubmitted-draft");
		}
		await page.goto(path);
		await openFilters();
		const identity = page.getByLabel(view === "audit" ? "调用者" : "密钥标识", { exact: true });
		await identity.fill("submitted-draft");
		await page.getByRole("button", { name: "应用筛选", exact: true }).click();
		await expect
			.poll(() => new URL(page.url()).searchParams.get(view === "audit" ? "actor" : "key_id"))
			.toBe("submitted-draft");
		await expect.poll(() => new URL(page.url()).searchParams.get("from")).toBe("2026-10-01");
		await page
			.getByRole("group", { name: "筛选操作", exact: true })
			.getByRole("button", { name: "清除筛选", exact: true })
			.click();
		await expect.poll(() => new URL(page.url()).search).toBe("");
		await expect(identity).toHaveValue("");
	});
}

test("audit compound cells retain method, route, errors and uniform virtual rows", async ({
	page,
	admin,
}) => {
	const memory = await admin.memory();
	for (let index = 0; index < 40; index++) {
		const response = await admin.response(
			index % 2 ? "/spaces/operations-filter-missing" : `/spaces/${memory.space}`,
		);
		expect(response.status()).toBe(index % 2 ? 404 : 200);
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/audit?action=%2Fapi%2Fadmin%2Fspaces%2F%3Aslug");
	const table = page.getByRole("table", { name: "审计记录", exact: true });
	await expect(table.locator("[data-audit-row]").first()).toBeVisible();
	await expect(table.getByRole("columnheader")).toHaveText([
		"时间",
		"请求",
		"结果",
		"耗时",
		"调用者",
		"请求标识",
	]);
	const rows = table.locator("[data-audit-row]");
	const heights = await rows.evaluateAll((elements) =>
		elements.map((element) => element.getBoundingClientRect().height),
	);
	expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
	const failure = rows.filter({ hasText: "404" }).first();
	const request = failure.getByRole("cell").nth(1);
	await expect(request.getByText("GET", { exact: true })).toBeVisible();
	await expect(request.locator("code")).toBeVisible();
	const result = failure.getByRole("cell").nth(2);
	await expect(result).toContainText("404");
	await expect(result).not.toHaveText("404");
	const total = Number(await table.getAttribute("aria-rowcount"));
	await page.getByLabel("可滚动的审计记录", { exact: true }).evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(table.locator(`[data-audit-row][aria-rowindex="${total}"]`)).toBeInViewport({
		ratio: 1,
	});
	await expect(page.getByRole("button", { name: "导出 CSV", exact: true })).toBeVisible();
});
