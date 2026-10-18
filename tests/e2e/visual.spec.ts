import { capture, expect, test } from "./fixtures";
import { assertL3Isolation } from "./setup";

test("populated dashboard visual acceptance on isolated real data", async ({
	page,
	admin,
	request,
}, info) => {
	test.setTimeout(180_000);
	const memory = await admin.memory(
		"# 设计记录\n\n把知识保存在清晰、可检索的空间里。\n\n## 检索策略\n\n关键词检索与语义检索互补，所有写入保留版本。\n\n## 协作约定\n\n- 保留来源与事件时间\n- 修改前核对版本\n- 删除后可从回收站恢复\n",
	);
	const title = "知识工作台：检索与协作";
	await admin.json(
		`/memories/${memory.id}`,
		"PATCH",
		{ title },
		{ "If-Match": String(memory.version) },
	);
	const trashed = await admin.memory("# 待整理资料\n\n稍后归档的阅读笔记。\n");
	await admin.json(`/memories/${trashed.id}`, "DELETE", undefined, {
		"If-Match": String(trashed.version),
	});
	const credential = await admin.json<{ plaintext: string; key: { id: string } }>("/keys", "POST", {
		name: "知识采集助手",
		role: "readonly",
	});
	const keyCall = await request.get("/api/v1/me", {
		headers: { Authorization: `Bearer ${credential.plaintext}` },
	});
	expect(keyCall.status()).toBe(200);
	await assertL3Isolation();
	const scheduled = await request.get("/cdn-cgi/local/scheduled?format=json");
	expect(scheduled.ok()).toBe(true);
	expect(scheduled.headers()["content-type"]).toContain("application/json");
	const usage = await admin.json<{ items: { key_id: string; calls: number }[] }>(
		"/usage?limit=200",
	);
	expect(usage.items.some((row) => row.key_id === credential.key.id && row.calls > 0)).toBe(true);
	const routes = [
		["overview", "/", "总览"],
		["memories", "/memories", "记忆库"],
		["reader", `/memories/${memory.id}`, title],
		["editor", `/memories/${memory.id}/edit`, "编辑记忆"],
		["history", `/memories/${memory.id}/history?from=1&to=2`, "版本历史"],
		["search", `/search?q=${encodeURIComponent(title)}`, "搜索"],
		["keys", "/keys", "接口密钥"],
		["usage", "/usage", "每日用量"],
		["audit", "/audit", "审计日志"],
		["tags", "/tags", "标签"],
		["spaces", "/spaces", "空间"],
		["trash", "/trash", "回收站"],
		["graph", "/graph", "关系图"],
		["timeline", "/timeline", "时间线"],
		["settings", "/settings", "设置"],
		["embedding", "/settings/embedding", "向量模型"],
	] as const;
	const errors: string[] = [];
	const endpoints: Record<string, string[]> = {
		overview: ["/spaces", "/usage", "/memories", "/trash", "/changes"],
		memories: ["/memories"],
		reader: [`/memories/${memory.id}`],
		editor: [`/memories/${memory.id}`],
		history: [`/memories/${memory.id}/versions`, `/memories/${memory.id}/diff`],
		search: ["/search"],
		keys: ["/keys", "/usage"],
		usage: ["/usage"],
		audit: ["/audit"],
		tags: ["/tags", "/memories"],
		spaces: ["/spaces", "/keys"],
		trash: ["/trash"],
		graph: ["/memories"],
		timeline: ["/memories"],
		settings: ["/embedding-profiles"],
		embedding: ["/settings/embedding"],
	};
	page.on("pageerror", (error) => errors.push(error.message));
	for (const variant of [
		"desktop-light",
		"tablet-light",
		"mobile-dark",
		"desktop-dark-reduced",
	] as const) {
		await page.setViewportSize(
			variant === "mobile-dark"
				? { width: 390, height: 844 }
				: variant === "tablet-light"
					? { width: 768, height: 900 }
					: { width: 1440, height: 1000 },
		);
		await page.emulateMedia({
			colorScheme: variant.endsWith("light") ? "light" : "dark",
			reducedMotion: variant === "desktop-dark-reduced" ? "reduce" : "no-preference",
		});
		for (const [name, path, heading] of routes) {
			const responses =
				endpoints[name]?.map((endpoint) =>
					page.waitForResponse(
						(response) => new URL(response.url()).pathname === `/api/admin${endpoint}`,
					),
				) ?? [];
			await page.goto(path);
			for (const response of await Promise.all(responses))
				expect(response.ok(), `${name} real API response`).toBe(true);
			await expect(
				page.getByRole("heading", { level: 1, name: heading, exact: true }),
			).toBeVisible();
			if (variant === "tablet-light" && name !== "reader") {
				const lines = await page
					.getByRole("heading", { level: 1, name: heading, exact: true })
					.evaluate(
						(element) =>
							element.getBoundingClientRect().height /
							Number.parseFloat(getComputedStyle(element).lineHeight),
					);
				expect(lines, `${name}: page actions must not crush a short heading`).toBeLessThan(1.2);
			}
			await expect(page.getByRole("alert")).toHaveCount(0);
			await expect(page.getByRole("main").getByText(/^(正在|.*尚未加载)/)).toHaveCount(0);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
				`${variant}/${name} document overflow`,
			).toBe(true);
			expect(errors).toEqual([]);
			if (name === "keys") {
				const trend = page.getByRole("group", {
					name: "知识采集助手 近 30 天每日调用量",
					exact: true,
				});
				await expect(trend).toContainText("1 次调用");
				await expect(trend).toContainText(`${new Date().toISOString().slice(0, 10)}：1 次`);
			}
			await capture(page, info, `${variant}-${name}`);
			if (name === "search") {
				await info.attach(`${variant}-search-top`, {
					body: JSON.stringify(
						await page.getByRole("textbox", { name: "搜索记忆", exact: true }).boundingBox(),
					),
					contentType: "application/json",
				});
			}
			if (variant === "mobile-dark" && name === "overview") {
				const opener = page.getByRole("button", { name: "打开导航", exact: true });
				await opener.click();
				await expect(page.getByRole("dialog")).toBeInViewport({ ratio: 1 });
				await capture(page, info, "mobile-dark-navigation-open");
				await page.keyboard.press("Escape");
				await expect(page.getByRole("dialog")).not.toBeVisible();
				await expect(opener).toBeFocused();
			}
		}
	}
	await admin.json(`/keys/${credential.key.id}/revoke`, "POST");
});

test("successful empty search uses a Chinese icon and primary action", async ({ page }, info) => {
	await page.goto("/search?q=不存在的知识条目92741059");
	await expect(page.getByText("没有匹配结果", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "重新搜索", exact: true })).toBeVisible();
	expect(await page.getByRole("main").locator("svg.lucide-search").count()).toBeGreaterThan(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
	await capture(page, info, "search-empty-icon-action");
});
