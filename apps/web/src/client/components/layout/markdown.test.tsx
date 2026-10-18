import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { markdownContents } from "../../viewmodels/memories-markdown";
import { Markdown, MarkdownContents, navigateToMarkdownHeading } from "./markdown";

afterEach(() => vi.unstubAllGlobals());

it("requests explicit TOC navigation on every unmodified click, including repeated hash targets", () => {
	const entry = { id: "heading-follow-up", text: "Follow-up", depth: 2, offset: 0 };
	const onNavigate = vi.fn();
	const contents = MarkdownContents({ entries: [entry], onNavigate });
	const link = contents.props.children[0].props.children;
	const preventDefault = vi.fn();
	const event = { preventDefault, button: 0 };
	expect(link.props.href).toBe("#heading-follow-up");
	link.props.onClick(event);
	link.props.onClick(event);
	expect(preventDefault).toHaveBeenCalledTimes(2);
	expect(onNavigate.mock.calls).toEqual([[entry.id], [entry.id]]);
	link.props.onClick({ ...event, metaKey: true });
	expect(onNavigate).toHaveBeenCalledTimes(2);
	const native = MarkdownContents({ entries: [entry] }).props.children[0].props.children;
	native.props.onClick(event);
	expect(preventDefault).toHaveBeenCalledTimes(2);
});

it("focuses and scrolls to the actual heading after sheet dismissal even for the same hash", () => {
	const heading = { focus: vi.fn(), scrollIntoView: vi.fn() };
	const getElementById = vi.fn().mockReturnValue(heading);
	const location = { hash: "heading-follow-up" };
	vi.stubGlobal("document", { getElementById });
	vi.stubGlobal("window", { location });
	expect(navigateToMarkdownHeading("heading-follow-up")).toBe(true);
	expect(navigateToMarkdownHeading("heading-follow-up")).toBe(true);
	expect(location.hash).toBe("heading-follow-up");
	expect(heading.focus.mock.calls).toEqual([[{ preventScroll: true }], [{ preventScroll: true }]]);
	expect(heading.scrollIntoView.mock.calls).toEqual([[{ block: "start" }], [{ block: "start" }]]);
	getElementById.mockReturnValue(null);
	expect(navigateToMarkdownHeading("heading-missing")).toBe(false);
	expect(heading.focus).toHaveBeenCalledTimes(2);
	expect(location.hash).toBe("heading-follow-up");
});

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
			`<span class="octo-memory-toc-indent" data-depth="${entry.depth}">${entry.text || "未命名章节"}</span>`,
		);
	}
});

it("localizes prose controls without translating user content", () => {
	const html = renderToStaticMarkup(
		<Markdown source={"# User title\n- [x] Done\n- [ ] Todo\n\n![](octo://att/a1)"} />,
	);
	expect(html).toContain('aria-label="已完成任务"');
	expect(html).toContain('aria-label="未完成任务"');
	expect(html).toContain("正在加载附件");
	expect(html).toContain("User title");
	expect(html).toMatch(/<h1\b[^>]*tabindex="-1"/);
	expect(renderToStaticMarkup(<MarkdownContents entries={[]} />)).toContain("本页目录");
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
