import { ThemeProvider } from "@nocoo/basalt";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryModel, type LibraryState } from "../viewmodels/library";
import { GraphPage, SpacesPage, TagsPage, TimelinePage, TrashPage } from "./library";

const snapshot = vi.hoisted(() => ({ state: null as LibraryState | null }));
vi.mock("../components/layout/use-model", () => ({
	useModel: (model: LibraryModel) => snapshot.state ?? model.state,
}));
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
const pages = [
	["/tags", TagsPage, "No tags match your search."],
	["/spaces", SpacesPage, "No spaces found."],
	["/trash", TrashPage, "Trash is empty for these filters."],
	["/graph", GraphPage, "0 nodes"],
	["/timeline", TimelinePage, "No dated memories"],
] as const;

afterEach(() => {
	snapshot.state = null;
});
describe("library unknown, failed and empty states", () => {
	it.each(pages)(
		"does not claim an empty %s library before the initial request starts",
		(url, Page, empty) => {
			const html = render(Page, url);
			expect(html).toContain("Loading library...");
			expect(html).not.toContain(empty);
			expect(html).not.toContain("0 memories loaded");
		},
	);
	it.each(pages)(
		"does not claim an empty %s library while initial loading is pending",
		(url, Page, empty) => {
			snapshot.state = { ...new LibraryModel("graph").state, busy: true };
			const html = render(Page, url);
			expect(html).toContain("Loading library...");
			expect(html).not.toContain(empty);
			expect(html).not.toContain("0 memories loaded");
		},
	);
	it.each(pages)(
		"shows first-load failure and retry instead of false-empty %s data",
		(url, Page, empty) => {
			snapshot.state = { ...new LibraryModel("graph").state, error: "request_failed" };
			const html = render(Page, url);
			expect(html).toContain('role="alert"');
			expect(html).toContain("request_failed");
			expect(html).toContain("Retry");
			expect(html).not.toContain("Loading library...");
			expect(html).not.toContain(empty);
			expect(html).not.toContain("0 memories loaded");
		},
	);
	it.each(pages)(
		"shows legitimately empty %s data only after a successful read",
		(url, Page, empty) => {
			snapshot.state = { ...new LibraryModel("graph").state, ready: true };
			expect(render(Page, url)).toContain(empty);
		},
	);
	it.each(pages)("keeps cached %s content visible when a refresh fails", (url, Page) => {
		snapshot.state = {
			...new LibraryModel("graph").state,
			ready: true,
			error: "offline",
			memories: [
				{
					id: "memory-1",
					title: "Cached memory",
					space: "work",
					tags: ["topic"],
					version: 1,
					created_at: "2026-10-17T00:00:00Z",
					event_time: "2026-10-17T00:00:00Z",
				},
			],
			tags: [{ id: "t", name: "topic", display_name: "Cached topic", use_count: 1 }],
			spaces: [
				{
					id: "s",
					slug: "work",
					name: "Cached space",
					description: "",
					owner_key_id: null,
					memory_count: 1,
				},
			],
		};
		const html = render(Page, url);
		expect(html).toContain("offline");
		expect(html).toContain("Retry");
		expect(html).toContain("Cached");
		if (Page === GraphPage) {
			expect(html).toContain("2 nodes");
			expect(html).not.toContain("0 nodes");
		}
	});
});
