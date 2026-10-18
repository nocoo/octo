import { readFileSync } from "node:fs";
import type { DataTableProps, DataTableSort } from "@nocoo/basalt/components/data-table";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	EmbeddingModel,
	EmbeddingProfile,
	SettingsModel,
} from "../viewmodels/operations-embedding";
import { EmbeddingPage, SettingsPage } from "./operations-embedding";

const fixture = vi.hoisted(() => ({
	state: {} as Partial<EmbeddingModel["state"]>,
	settings: {} as Partial<SettingsModel["state"]> & { loaded?: boolean },
	sort: null as DataTableSort | null,
}));
vi.mock("@nocoo/basalt/components/data-table", async (original) => {
	const module = await original<typeof import("@nocoo/basalt/components/data-table")>();
	return {
		...module,
		DataTable: (props: DataTableProps<EmbeddingProfile>) => (
			<module.DataTable {...props} defaultSort={fixture.sort} />
		),
	};
});
vi.mock("../viewmodels/operations-embedding", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-embedding")>();
	return {
		...module,
		EmbeddingModel: class extends module.EmbeddingModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.state };
			}
		},
		SettingsModel: class extends module.SettingsModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.settings };
			}
		},
	};
});

beforeEach(() => {
	fixture.state = {};
	fixture.settings = {};
	fixture.sort = null;
});

describe("profile read states", () => {
	function render() {
		return renderToStaticMarkup(
			<MemoryRouter>
				<SettingsPage />
			</MemoryRouter>,
		);
	}
	it("gives profile columns minimum readable widths without a second scroll container", () => {
		fixture.settings = {
			loaded: true,
			profiles: [
				{
					id: "te3-small-1536",
					model: "text-embedding-3-small",
					dims: 1536,
					metric: "cosine",
					active: true,
					created_at: "2026-10-01T00:00:00.000Z",
				},
			],
		};
		const html = render();
		const widths = ["22ch", "28ch", "10ch", "16ch", "26ch", "12ch"];
		const headers = [...html.matchAll(/<th\b[^>]*>/g)].map((match) => match[0]);
		const cells = [...html.matchAll(/<td\b[^>]*>/g)].map((match) => match[0]);
		expect(headers).toHaveLength(widths.length);
		expect(cells).toHaveLength(widths.length);
		for (const [index, width] of widths.entries()) {
			expect(headers[index]).toContain(`style="width:${width};min-width:${width}"`);
			expect(cells[index]).toContain(`style="min-width:${width}"`);
			expect(cells[index]).toContain("whitespace-nowrap");
		}
		expect(html.match(/aria-label="嵌入配置 scroll area"/g)).toHaveLength(1);
		expect(html).toContain("relative min-w-0 overflow-auto");
	});

	it.each(["asc", "desc"] as const)("sorts active profile status %s through Basalt", (dir) => {
		fixture.settings = {
			loaded: true,
			profiles: [
				{
					id: "profile-inactive",
					model: "model",
					dims: 512,
					metric: "cosine",
					active: false,
					created_at: "2026-10-01T00:00:00.000Z",
				},
				{
					id: "profile-active",
					model: "model",
					dims: 512,
					metric: "cosine",
					active: true,
					created_at: "2026-10-01T00:00:00.000Z",
				},
			],
		};
		fixture.sort = { id: "active", dir };
		const html = render();
		const ids = [...html.matchAll(/<td[^>]*>(profile-(?:active|inactive))<\/td>/g)].map(
			(match) => match[1],
		);
		expect(ids).toEqual(
			dir === "asc"
				? ["profile-active", "profile-inactive"]
				: ["profile-inactive", "profile-active"],
		);
	});
	it.each([null, "无法加载嵌入配置。"])(
		"does not assert an empty unknown profiles list: %s",
		(error) => {
			fixture.settings = { loaded: false, error };
			const html = render();
			expect(html).not.toContain("尚未配置嵌入配置。");
			if (error) expect(html).toContain(error);
		},
	);
	it("distinguishes successful emptiness and preserves profiles after a refresh failure", () => {
		fixture.settings = { loaded: true };
		expect(render()).toContain("尚未配置嵌入配置。");
		fixture.settings = {
			loaded: true,
			error: "无法加载嵌入配置。",
			profiles: [
				{
					id: "cached-profile",
					model: "active-model",
					dims: 512,
					metric: "cosine",
					active: true,
					created_at: "2026-10-01T00:00:00.000Z",
				},
			],
		};
		const html = render();
		expect(html).toContain("cached-profile");
		expect(html).toContain("无法加载嵌入配置。");
		expect(html).toContain("余弦相似度");
		expect(html).toContain("已启用");
		expect(html).not.toContain(">cosine<");
	});
});

describe("embedding configuration visibility", () => {
	it.each([null, "无法加载嵌入设置。"])(
		"keeps unknown settings out of the editor with error %s",
		(error) => {
			fixture.state = { loaded: false, error };
			const html = renderToStaticMarkup(<EmbeddingPage />);
			expect(html).not.toContain("尚未配置接口密钥");
			expect(html).not.toContain("text-embedding-3-small");
			expect(html).not.toContain("<form");
			expect(html).not.toContain("保存设置");
			expect(html).not.toContain("清除已保存密钥");
			expect(html).toContain("配置尚未加载");
			if (error) expect(html).toContain(error);
		},
	);

	it("retains loaded stale values and the visible refresh error", () => {
		fixture.state = {
			loaded: true,
			error: "无法加载嵌入设置。",
			config: {
				base_url: "https://gateway.example",
				model: "active-model",
				dims: 512,
				backfill_enabled: true,
				api_key_set: true,
				api_key_mask: "****abcd",
			},
		};
		const html = renderToStaticMarkup(<EmbeddingPage />);
		expect(html).toContain("无法加载嵌入设置。");
		expect(html).toContain('value="active-model"');
		expect(html).toContain("****abcd");
		expect(html).toContain("<form");
		expect(html).toContain("保存设置");
		expect(html).not.toContain("disabled=");
	});
});

describe("M7 embedding test result SSR", () => {
	it.each([
		["embedder_unavailable", "嵌入服务暂时不可用。", "status", "上游状态异常", 503],
		["vector_dimension_mismatch", "向量维度不匹配。", "dims", "向量维度不匹配", undefined],
	] as const)(
		"shows only safe Chinese, documented code %s, stage and numeric status",
		(code, message, stage, stageLabel, status) => {
			fixture.state = {
				loaded: true,
				testResult: {
					latency_ms: 12,
					dims: 8,
					match: false,
					error_code: code,
					reason: status === undefined ? { stage } : { stage, upstream_status: status },
				},
			};
			const html = renderToStaticMarkup(<EmbeddingPage />);
			expect(html).toContain(message);
			expect(html).toContain(code);
			expect(html).toContain("失败阶段");
			expect(html).toContain(stageLabel);
			expect(html).toContain("实际维度");
			expect(html).toContain("12 毫秒");
			if (status === undefined) {
				expect(html).not.toContain("上游状态码");
			} else {
				expect(html).toContain("上游状态码");
				expect(html).toContain(String(status));
			}
			const well = html.slice(html.indexOf(code));
			expect(well).not.toMatch(/gateway\.example|private-upstream|Authorization|Bearer /);
		},
	);

	it.each([
		["config", "配置不完整"],
		["decrypt", "密钥解密失败"],
		["request", "网关请求失败"],
		["redirect", "上游重定向被拒绝"],
		["timeout", "网关请求超时"],
		["parse", "上游响应解析失败"],
	] as const)("renders Chinese stage label for %s without leaking bodies", (stage, label) => {
		fixture.state = {
			loaded: true,
			testResult: {
				latency_ms: 4,
				dims: null,
				match: false,
				error_code: "embedder_unavailable",
				reason: { stage },
			},
		};
		const html = renderToStaticMarkup(<EmbeddingPage />);
		const well = html.slice(html.indexOf("embedder_unavailable"));
		expect(well).toContain(label);
		expect(well).toContain("失败阶段");
		expect(well).not.toContain("upstream");
		expect(well).not.toMatch(/gateway\.example|private-body|Authorization|Bearer /);
	});

	it("hides failure stage details on a successful probe", () => {
		fixture.state = {
			loaded: true,
			testResult: {
				latency_ms: 5,
				dims: 1536,
				match: true,
				error_code: null,
				reason: null,
			},
		};
		const html = renderToStaticMarkup(<EmbeddingPage />);
		expect(html).toContain("连接成功");
		expect(html).not.toContain("失败阶段");
		expect(html).not.toContain("上游状态码");
	});

	it("does not fabricate a server version or generic settings payload", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<SettingsPage />
			</MemoryRouter>,
		);
		expect(html).not.toContain("版本");
		expect(html).not.toContain("0.1.1");
	});
});

it("shows structured probe failures and technical details immediately after Test", () => {
	fixture.state = {
		loaded: true,
		testResult: {
			latency_ms: 12,
			dims: 8,
			match: false,
			error_code: "embedder_unavailable",
			reason: { stage: "status", upstream_status: 503 },
		},
	};
	const html = renderToStaticMarkup(<EmbeddingPage />);
	const form = html.slice(html.indexOf("<form"), html.indexOf("</form>") + "</form>".length);
	expect(form).not.toContain("连接结果");
	expect(form).toContain('role="alert"');
	expect(form).toContain("embedder_unavailable");
	expect(form).toContain("上游状态码");
	expect(form).toContain("12 毫秒");
	expect(form).toContain("grid gap-basalt-layout-sm");
	expect(form).toContain("<dl");
	expect(form.indexOf("测试连接")).toBeLessThan(form.indexOf("连接失败"));
	expect([...form.matchAll(/连接失败/g)]).toHaveLength(1);
});

it("keeps transport failures beside the test action and keeps key clearing compact", () => {
	fixture.state = { loaded: true, error: "无法测试嵌入连接。" };
	const html = renderToStaticMarkup(<EmbeddingPage />);
	const form = html.slice(html.indexOf("<form"), html.indexOf("</form>") + "</form>".length);
	expect(form).toContain("无法测试嵌入连接。");
	expect(form).toContain("ops-embedding-key-actions");
	expect(form).toContain("ops-embedding-test-actions");
});

it("shows the current action error instead of a stale probe result", () => {
	fixture.state = {
		loaded: true,
		error: "无法测试嵌入连接。",
		testResult: {
			latency_ms: 5,
			dims: 1536,
			match: true,
			error_code: null,
			reason: null,
		},
	};
	const html = renderToStaticMarkup(<EmbeddingPage />);
	const form = html.slice(html.indexOf("<form"), html.indexOf("</form>") + "</form>".length);
	expect(form).toContain("无法测试嵌入连接。");
	expect(form).not.toContain("向量维度与当前配置匹配。");
	expect([...form.matchAll(/id="embedding-test-feedback"/g)]).toHaveLength(1);
});

it("scrolls only explicit connection-test feedback into view without moving focus", () => {
	const source = readFileSync(new URL("./operations-embedding.tsx", import.meta.url), "utf8");
	expect(source).toContain("testFeedbackRequested.current = true");
	expect(source).toContain('scrollIntoView({ block: "nearest" })');
	expect(source).toContain('id="embedding-test-feedback"');
	expect(source).toContain("!clearing");
	expect(source).not.toContain("focus()");
});
