import { randomUUID } from "node:crypto";
import { capture, expect, test } from "./fixtures";

test("ordinary key dialogs return focus without changing credentials", async ({ page, admin }) => {
	const name = `focus-${randomUUID()}`;
	await admin.json("/keys", "POST", { name, role: "readonly" });
	await page.setViewportSize({ width: 390, height: 480 });
	await page.goto("/keys");
	for (const label of ["创建密钥", `编辑 ${name}`, `轮换 ${name}`]) {
		const opener = page.getByRole("button", { name: label, exact: true }).first();
		await opener.focus();
		await opener.press("Enter");
		await expect(page.getByRole("dialog")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).not.toBeVisible();
		await expect(opener).toBeFocused();
	}
});

test("usage and audit filters keep date ranges and submit/reset actions together", async ({
	page,
}) => {
	for (const width of [390, 768, 1440]) {
		await page.setViewportSize({ width, height: 844 });
		for (const path of ["/usage", "/audit"]) {
			await page.goto(path);
			const dates = page.getByRole("group", { name: "日期范围", exact: true });
			await expect(dates.getByLabel("开始日期", { exact: true })).toBeVisible();
			await expect(dates.getByLabel("结束日期", { exact: true })).toBeVisible();
			const actions = page.getByRole("group", { name: "筛选操作", exact: true });
			const apply = await actions
				.getByRole("button", { name: "应用筛选", exact: true })
				.boundingBox();
			const clear = await actions
				.getByRole("button", { name: "清除筛选", exact: true })
				.boundingBox();
			expect(apply?.y).toBeCloseTo(clear?.y ?? -1, 0);
			expect(
				await actions.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
			).toBe(true);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true,
			);
		}
	}
});

for (const height of [480, 650]) {
	test(`embedding transport and upstream errors enter the viewport at 390x${height}`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width: 390, height });
		let failure = "transport";
		await page.route("**/api/admin/settings/embedding/test", (route) =>
			failure === "transport"
				? route.fulfill({ status: 503, json: { error: { code: "unavailable" } } })
				: route.fulfill({
						json: {
							latency_ms: 47,
							dims: null,
							match: false,
							error_code: "embedder_unavailable",
							reason: { stage: "status", upstream_status: 502 },
						},
					}),
		);
		for (const mode of ["transport", "upstream"]) {
			failure = mode;
			await page.goto("/settings/embedding");
			await page
				.getByRole("textbox", { name: "网关地址", exact: true })
				.fill("http://127.0.0.1:27059");
			await page.getByRole("button", { name: "测试连接", exact: true }).click();
			const feedback = page.getByRole("main").getByRole("alert");
			await expect(feedback).toContainText(mode === "transport" ? "服务暂时不可用" : "连接失败");
			await expect(feedback).toBeInViewport({ ratio: 1 });
			await capture(page, info, `embedding-${mode}-visible-${height}`);
		}
	});
}
