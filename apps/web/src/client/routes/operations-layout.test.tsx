import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditPage, EmbeddingPage, KeysPage, SettingsPage, UsagePage } from "./operations";

const fixture = vi.hoisted(() => ({ loading: false, loaded: false }));
vi.mock("../viewmodels/operations-keys", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-keys")>();
	return {
		...module,
		KeysModel: class extends module.KeysModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture };
			}
		},
	};
});
vi.mock("../viewmodels/operations-embedding", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-embedding")>();
	return {
		...module,
		SettingsModel: class extends module.SettingsModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture };
			}
		},
	};
});
vi.mock("../viewmodels/operations-observability", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-observability")>();
	return {
		...module,
		UsageModel: class extends module.UsageModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture };
			}
		},
		AuditModel: class extends module.AuditModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture };
			}
		},
	};
});

beforeEach(() => {
	fixture.loading = false;
	fixture.loaded = false;
});

describe("installed Basalt operations composition", () => {
	it.each([
		[KeysPage, "接口密钥", "密钥列表"],
		[EmbeddingPage, "向量模型", "网关配置"],
		[SettingsPage, "设置", "嵌入配置"],
		[UsagePage, "用量与健康状态", "基础设施"],
		[AuditPage, "审计日志", "请求记录"],
	] as const)("renders %s with Chinese headings and Basalt layout", (Page, title, region) => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<Page />
			</MemoryRouter>,
		);
		expect(html).toMatch(/^<div class="grid gap-basalt-layout /);
		expect(html).toContain("grid-template-columns:repeat(1, minmax(0, 1fr))");
		expect(html).toContain(title);
		expect(html).toContain(region);
		expect(html).toContain("data-basalt-surface=");
		expect(html).not.toMatch(
			/ops-(?:page|stack|row|inline|actions|filters|fields|chart-grid|chart|spark)\b/,
		);
		expect(html).not.toMatch(
			/>\s*(?:Refresh|Retry|Loading|Never|Unavailable|Try again|Settings|API keys)\s*</,
		);
	});
	it.each([
		[KeysPage, "暂无接口密钥。", "创建密钥", "key-round"],
		[SettingsPage, "尚未配置嵌入配置。", "配置嵌入网关", "settings-2"],
		[UsagePage, "此范围内暂无用量", "清除筛选", "chart-no-axes-combined"],
		[AuditPage, "没有符合筛选条件的审计记录", "清除筛选", "scroll-text"],
	] as const)(
		"gives successful %s emptiness an icon and primary action",
		(Page, title, action, icon) => {
			fixture.loaded = true;
			const html = renderToStaticMarkup(
				<MemoryRouter>
					<Page />
				</MemoryRouter>,
			);
			expect(html).toContain(title);
			expect(html).toContain(`lucide-${icon}`);
			expect(html).toContain(action);
			expect(html).toContain("text-center p-basalt-card");
			expect(html).toMatch(new RegExp(`bg-basalt-primary[^>]*>[\\s\\S]*?${action}</(?:button|a)>`));
		},
	);

	it.each([KeysPage, SettingsPage, UsagePage])("localizes initial loading for %s", (Page) => {
		fixture.loading = true;
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<Page />
			</MemoryRouter>,
		);
		expect(html).toContain("正在加载");
		expect(html).not.toMatch(/(?:>Loading<|aria-label="Loading")/);
	});

	it("uses the installed accessible scroll viewport for virtualized audit rows", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<AuditPage />
			</MemoryRouter>,
		);
		expect(html).toContain('data-slot="scroll-area-viewport"');
		expect(html).toContain('aria-label="可滚动的审计记录"');
		expect(html).toContain('tabindex="0"');
		expect(html).toContain("方向键");
	});

	it("does not recreate layout containers or raw spacing in route source", () => {
		for (const name of ["operations-keys", "operations-embedding", "operations-observability"]) {
			const source = readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8");
			expect(source).not.toMatch(/<(?:div|section|article|aside|header|footer)\b/);
			expect(source).not.toMatch(/(?:padding|margin|gap):\s*\d/);
		}
		const css = readFileSync(new URL("./operations.css", import.meta.url), "utf8");
		expect(css).not.toMatch(/(?:padding|margin|gap):\s*\d/);
	});
});
