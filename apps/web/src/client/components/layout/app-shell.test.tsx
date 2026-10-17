import { ThemeProvider, TooltipProvider } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

const identity = vi.hoisted(() => ({ error: null as string | null }));
vi.mock("./use-model", () => ({
	useModel: () => ({ email: null, error: identity.error }),
}));

afterEach(() => {
	vi.unstubAllGlobals();
	identity.error = null;
});

function renderShell() {
	vi.stubGlobal("matchMedia", () => ({ matches: false }));
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<TooltipProvider>
				<MemoryRouter>
					<Routes>
						<Route element={<AppShell />}>
							<Route index element={<PageHeader title="Overview" />} />
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
	expect(html).toContain("Overview");
	expect(html).toContain("总览");
});
