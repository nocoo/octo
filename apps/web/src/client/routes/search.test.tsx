import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { SearchPage } from "./search";

it("gives the query flexible width and keeps advanced fusion collapsed without losing form values", () => {
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter
				initialEntries={[
					"/search?q=worker&mode=vector&fusion=weighted&k=35&fts_weight=0&vector_weight=2&limit=20",
				]}
			>
				<SearchPage />
			</MemoryRouter>
		</ThemeProvider>,
	);
	expect(html).toContain('class="octo-search-query"');
	expect(html).toContain("octo-search-query-field");
	expect(html).toMatch(/<input[^>]*data-search-input/);
	expect(html).toMatch(
		/<button[^>]*aria-label="Advanced fusion options"[^>]*aria-expanded="false"/,
	);
	const advanced = html.match(/<div\b[^>]*data-search-advanced="true"[^>]*>/)?.[0] ?? "";
	expect(advanced).toContain('data-state="closed"');
	expect(advanced).toContain('hidden=""');
	for (const name of ["mode", "fusion", "k", "fts_weight", "vector_weight", "limit"])
		expect(html).toContain(`name="${name}"`);
	for (const [name, value] of [
		["k", "35"],
		["fts_weight", "0"],
		["vector_weight", "2"],
		["limit", "20"],
	])
		expect(html).toMatch(new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"`));
});
