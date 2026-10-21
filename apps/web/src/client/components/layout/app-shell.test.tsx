import { ThemeProvider, TooltipProvider } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

const identity = vi.hoisted(() => ({
	email: null as string | null,
	name: null as string | null,
	avatar: null as string | null,
	error: null as string | null,
}));
vi.mock("./use-model", () => ({
	useModel: () => identity,
}));

afterEach(() => {
	vi.unstubAllGlobals();
	identity.error = null;
	identity.email = null;
	identity.name = null;
	identity.avatar = null;
});

function renderShell(path = "/") {
	vi.stubGlobal("matchMedia", () => ({ matches: false }));
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<TooltipProvider>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route element={<AppShell />}>
							<Route path="*" element={<PageHeader title="总览" />} />
						</Route>
					</Routes>
				</MemoryRouter>
			</TooltipProvider>
		</ThemeProvider>,
	);
}

it("does not describe failed Access verification as still pending", () => {
	identity.error = "Unable to verify Access";
	const html = renderShell();
	expect(html).not.toContain("Access 身份验证中");
	expect(html).toContain("Access 身份未知");
});

it("leaves the single page heading to PageHeader", () => {
	const html = renderShell();
	expect(html.match(/<h1\b/g)).toHaveLength(1);
	expect(html).toContain("总览");
});

it("uses compact header chrome and monochrome navigation without mixed-language labels", () => {
	const html = renderShell();
	expect(html).toContain("octo-header");
	expect(html).toContain("octo-nav-icon");
	expect(html).not.toContain("data-tone");
	expect(html).toContain("Octo 项目主页");
	expect(html).not.toContain("Octo on Hexly");
});

it("uses the adopted transparent seahorse in the application rail", () => {
	const html = renderShell();
	expect(html).toContain('src="/logo-24.png"');
	expect(html).toContain('alt="Octo"');
});

it("separates the brand home link from the visible collapse control", () => {
	const html = renderShell();
	expect(html).toMatch(/<a\b[^>]*aria-label="Octo 首页"[^>]*>/);
	const collapse = html.match(/<button\b[^>]*aria-label="收起侧栏"[^>]*>[\s\S]*?<\/button>/)?.[0];
	expect(collapse).toBeDefined();
	expect(collapse).not.toContain("logo-24.png");
	expect(html).toContain("data-basalt-header-leading");
	expect(html).toContain('aria-label="返回上一页"');
	expect(html.indexOf('aria-label="收起侧栏"')).toBeLessThan(
		html.indexOf('data-slot="sidebar-nav"'),
	);
	expect(html).toContain("octo-version");
	expect(html).toContain('data-slot="sidebar-group"');
	expect(html).toContain('href="https://hexly.ai/projects/octo"');
	expect(html.indexOf('aria-label="GitHub 仓库"')).toBeLessThan(
		html.indexOf('aria-label="切换深色或浅色主题"'),
	);
});

it("shows the person supplied by the author service rather than a workspace identity", () => {
	identity.email = "owner@example.test";
	identity.name = "Li Zheng";
	const html = renderShell();
	expect(html).toContain("Li Zheng");
	expect(html).toContain("owner@example.test");
	expect(html).toContain(">LZ</span>");
	expect(html).not.toContain("私人知识工作台");
});

it("links back to the library and memory from version history", () => {
	const html = renderShell("/memories/one/history");
	expect(html).toContain('href="/memories"');
	expect(html).toContain('href="/memories/one"');
	expect(html).toMatch(/aria-current="page"[^>]*>版本历史<\/span>/);
});

it("uses the Basalt shell without duplicate custom layout wrappers", () => {
	const html = renderShell();
	expect(html.match(/data-basalt-island=/g)).toHaveLength(1);
	for (const removed of ["octo-island-wrap", "octo-rail-search", 'class="octo-brand"'])
		expect(html).not.toContain(removed);
	expect(html).toContain("空间");
	expect(html).toContain("接口密钥");
	expect(html).not.toContain("API Key");
	expect(html).not.toContain(">Space<");
});
