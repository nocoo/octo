import { ThemeProvider, TooltipProvider } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

afterEach(() => vi.unstubAllGlobals());

it("leaves the single page heading to PageHeader", () => {
	vi.stubGlobal("matchMedia", () => ({ matches: false }));
	const html = renderToStaticMarkup(
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
	expect(html.match(/<h1\b/g)).toHaveLength(1);
	expect(html).toContain("Overview");
	expect(html).toContain("总览");
});
