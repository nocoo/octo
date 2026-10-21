import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { markdownContents } from "../../viewmodels/memories-markdown";
import { Markdown, MarkdownContents } from "./markdown";
import {
	isCurrentMarkdownFragment,
	isPlainLinkClick,
	navigateToMarkdownHeading,
	restoreMarkdownHeading,
} from "./markdown-navigation";

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
	vi.stubGlobal("document", { getElementById: vi.fn().mockReturnValue(null) });
	vi.stubGlobal("window", { location: { hash: `#${entry.id}` } });
	native.props.onClick(event);
	expect(preventDefault).toHaveBeenCalledTimes(3);
});

it("recognizes equivalent encoded fragments for repeated chapter navigation", () => {
	vi.stubGlobal("window", { location: { hash: "#heading-%E4%B8%AD%E6%96%87" } });
	expect(isCurrentMarkdownFragment("#heading-中文")).toBe(true);
	expect(isCurrentMarkdownFragment("#heading-%E4%B8%AD%E6%96%87")).toBe(true);
	expect(isCurrentMarkdownFragment("#heading-other")).toBe(false);
	expect(isCurrentMarkdownFragment("#%invalid")).toBe(false);
});

it("ignores modified, secondary and prevented link clicks", () => {
	const event = {
		defaultPrevented: false,
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
	};
	expect(isPlainLinkClick(event)).toBe(true);
	for (const modifier of ["defaultPrevented", "metaKey", "ctrlKey", "shiftKey", "altKey"])
		expect(isPlainLinkClick({ ...event, [modifier]: true })).toBe(false);
	expect(isPlainLinkClick({ ...event, button: 1 })).toBe(false);
});

it("focuses and scrolls without mutating router-owned history", () => {
	const heading = { focus: vi.fn(), scrollIntoView: vi.fn() };
	const getElementById = vi.fn().mockReturnValue(heading);
	const location = { hash: "#previous" };
	vi.stubGlobal("document", { getElementById });
	vi.stubGlobal("window", { location });
	expect(navigateToMarkdownHeading("heading-follow-up")).toBe(true);
	expect(navigateToMarkdownHeading("heading-follow-up")).toBe(true);
	expect(location.hash).toBe("#previous");
	expect(heading.focus.mock.calls).toEqual([[{ preventScroll: true }], [{ preventScroll: true }]]);
	expect(heading.scrollIntoView.mock.calls).toEqual([[{ block: "start" }], [{ block: "start" }]]);
	getElementById.mockReturnValue(null);
	expect(navigateToMarkdownHeading("heading-missing")).toBe(false);
	expect(heading.focus).toHaveBeenCalledTimes(2);
	expect(location.hash).toBe("#previous");
});

it("restores encoded fragments and ignores absent, malformed or unknown headings", () => {
	const heading = { focus: vi.fn(), scrollIntoView: vi.fn() };
	const getElementById = vi.fn().mockReturnValue(heading);
	vi.stubGlobal("document", { getElementById });
	expect(restoreMarkdownHeading("#heading-%E4%B8%AD%E6%96%87")).toBe(true);
	expect(getElementById).toHaveBeenCalledWith("heading-中文");
	expect(restoreMarkdownHeading("")).toBe(false);
	expect(restoreMarkdownHeading("#%invalid")).toBe(false);
	getElementById.mockReturnValue(null);
	expect(restoreMarkdownHeading("#missing")).toBe(false);
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
	expect(html).toMatch(/<h3\b[^>]*tabindex="-1"/);
	expect(html).not.toMatch(/<h[12]\b/);
	expect(renderToStaticMarkup(<MarkdownContents entries={[]} />)).toContain("本页目录");
});

it("uses dedicated system reading typography and token-based prose rhythm", () => {
	const css = readFileSync(new URL("./markdown.css", import.meta.url), "utf8");
	const root = css.match(/\.octo-markdown\s*\{([^}]+)\}/)?.[1] ?? "";
	expect(root).toMatch(/font-family:\s*Charter, Georgia, "Songti SC", "Noto Serif CJK SC"/);
	expect(root).toContain("font-size: var(--basalt-text-xl)");
	expect(root).toContain("line-height: 1.65");
	expect(root).toContain("max-width: 72ch");
	expect(root).toContain("width: 100%");
	expect(root).toContain("margin-inline: auto");
	expect(css).not.toMatch(/@font-face|url\(/);
	expect(css).toMatch(
		/\.octo-markdown > :is\(h1, h2, h3, h4, h5, h6\):not\(:first-child\)\s*\{\s*margin-block-start: var\(--basalt-space-layout-sm\)/,
	);
	expect(css).toMatch(
		/\.octo-markdown :is\(blockquote, li\) > \* \+ \*[^}]*margin-block-start: var\(--basalt-space-layout-sm\)/,
	);
	expect(css).toMatch(
		/\.octo-markdown li > :is\(ul, ol\)\s*\{[^}]*margin-block-start: var\(--basalt-space-layout-sm\)/,
	);
	expect(renderToStaticMarkup(<Markdown source="Reading" />)).toContain("gap-basalt-layout ");
});

it("preserves safe attachment resolution and rejects unsafe Markdown URLs and raw HTML", () => {
	const html = renderToStaticMarkup(
		<Markdown
			source={[
				"[Attachment](octo://att/file_1)",
				"![Diagram](octo://att/image-1)",
				"![Pending](octo://att/pending)",
				"[Invalid attachment](octo://att/bad/path)",
				"[Unsafe](javascript:alert%281%29)",
				"![Unsafe image](data:image/svg+xml,unsafe)",
				"[Safe](https://example.com/reference)",
				'<script>alert("unsafe")</script>',
			].join("\n\n")}
			urls={{
				file_1: "/api/admin/attachments/file_1/content?token=signed",
				"image-1": "/api/admin/attachments/image-1/content?token=signed",
			}}
		/>,
	);
	expect(html).toContain('href="/api/admin/attachments/file_1/content?token=signed"');
	expect(html).toContain('src="/api/admin/attachments/image-1/content?token=signed"');
	expect(html).toContain('loading="lazy" referrerPolicy="no-referrer"');
	expect(html).toContain('<span class="octo-muted">Pending</span>');
	expect(html).toContain('href="https://example.com/reference" rel="noreferrer noopener"');
	expect(html).not.toMatch(/(?:href|src)="(?:javascript:|data:|octo:)/);
	expect(html).not.toContain("<script>");
});

it("retains GFM structure, alignment, nested lists and syntax highlighting", () => {
	const html = renderToStaticMarkup(
		<Markdown
			source={[
				"中文段落 with **strong** and ~~removed~~ plus `inline code`.",
				"| Left | Right |\n| :--- | ---: |\n| A | 2 |",
				"3. Third\n4. Fourth\n   - Nested",
				"> First paragraph\n>\n> Second paragraph",
				'```js\nconst greeting = "hello";\n```',
			].join("\n\n")}
		/>,
	);
	expect(html).toContain("<strong>strong</strong>");
	expect(html).toContain("<del>removed</del>");
	expect(html).toContain("<code>inline code</code>");
	expect(html).toContain('<th style="text-align:right">Right</th>');
	expect(html).toContain('<ol start="3">');
	expect(html).toContain("<ul>\n<li>Nested</li>\n</ul>");
	expect(html).toContain("<blockquote>\n<p>First paragraph</p>\n<p>Second paragraph</p>");
	expect(html).toContain('class="hljs-keyword"');
	expect(html).toContain('class="hljs-string"');
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
