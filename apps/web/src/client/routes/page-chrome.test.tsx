import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { GraphPage, SpacesPage, TagsPage, TimelinePage } from "./library";
import { MemoriesPage, MemoryPage } from "./memories";
import { EmbeddingPage, SettingsPage } from "./operations-embedding";
import { KeysPage } from "./operations-keys";
import { AuditPage, UsagePage } from "./operations-observability";
import { OverviewPage } from "./overview";
import { SearchPage } from "./search";
import { TrashPage } from "./trash";

it.each([
	OverviewPage,
	MemoriesPage,
	MemoryPage,
	SearchPage,
	TagsPage,
	SpacesPage,
	GraphPage,
	TimelinePage,
	KeysPage,
	UsagePage,
	AuditPage,
	TrashPage,
	SettingsPage,
	EmbeddingPage,
])("%s keeps a title and back control even before data loads", (Page) => {
	const html = renderToStaticMarkup(
		<ThemeProvider persist={false}>
			<MemoryRouter>
				<Page />
			</MemoryRouter>
		</ThemeProvider>,
	);
	const header =
		html.match(/class="grid gap-basalt-layout octo-page-header"[\s\S]*?<\/h1>/)?.[0] ?? "";
	expect(header).toMatch(/<h1\b[^>]*>[\s\S]+?<\/h1>/);
	expect(header).toContain('aria-label="返回上一页"');
	expect(html.match(/<h1\b/g)).toHaveLength(1);
});
