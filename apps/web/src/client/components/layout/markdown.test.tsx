import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { markdownContents } from "../../viewmodels/memories-markdown";
import { Markdown, MarkdownContents } from "./markdown";

it("renders installed Basalt TOC items directly under the list with indentation inside each item", () => {
	const entries = [
		{ id: "heading-title", text: "Title", depth: 1, offset: 0 },
		{ id: "heading-nested", text: "Nested", depth: 3, offset: 10 },
		{ id: "heading-empty", text: "", depth: 6, offset: 20 },
	];
	const html = renderToStaticMarkup(<MarkdownContents entries={entries} />);
	const list = html.match(/<ul\b[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
	const items = [...list.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map(([item]) => item);
	expect(items).toHaveLength(entries.length);
	expect(list).toBe(items.join(""));
	for (const [index, entry] of entries.entries()) {
		expect(items[index]).toContain(`href="#${entry.id}"`);
		expect(items[index]).toContain(
			`<span class="octo-memory-toc-indent" data-depth="${entry.depth}">${entry.text || "Untitled section"}</span>`,
		);
	}
});

it("matches every rendered TOC href to its actual Markdown heading id", () => {
	const source = [
		"# Setup & *notes*",
		"## API `config`",
		"## API `config`",
		"> ### Nested section",
		"",
		"Setext title",
		"------------",
		"",
		"```md",
		"# Not a heading",
		"```",
	].join("\n");
	const toc = renderToStaticMarkup(<MarkdownContents entries={markdownContents(source)} />);
	const body = renderToStaticMarkup(<Markdown source={source} />);
	const targets = [...toc.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
	const ids = [...body.matchAll(/<h[1-6]\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
	expect(targets).toEqual([
		"heading-setup--notes",
		"heading-api-config",
		"heading-api-config-1",
		"heading-nested-section",
		"heading-setext-title",
	]);
	expect(ids).toEqual(targets);
});
