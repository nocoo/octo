import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { GraphPage, SpacesPage, TagsPage, TimelinePage, TrashPage } from "./library";

vi.mock("./library-graph", () => ({ default: () => null }));

function render(Page: () => React.JSX.Element, url: string) {
	return renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter initialEntries={[url]}>
				<Page />
			</MemoryRouter>
		</ThemeProvider>,
	);
}

describe("library page installed-component boundaries", () => {
	it.each([
		[TagsPage, "/tags", "Tags"],
		[SpacesPage, "/spaces", "Spaces"],
		[TrashPage, "/trash", "Trash"],
		[GraphPage, "/graph", "Relationship graph"],
		[TimelinePage, "/timeline", "Timeline"],
	] as const)("renders %s using the actual Basalt package", (Page, url, title) => {
		expect(render(Page, url)).toContain(title);
	});
	it("shows exact UTC timestamp range controls without implying inclusive whole dates", () => {
		const html = render(TimelinePage, "/timeline?from=2026-10-17T00%3A00%3A00Z&zoom=hour");
		expect(html).toContain("Inclusive UTC timestamp");
		expect(html).toContain('value="2026-10-17T00:00:00Z"');
		expect(html).not.toContain('type="date"');
	});
});
