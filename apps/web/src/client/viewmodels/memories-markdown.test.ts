import { describe, expect, it } from "vitest";
import { diffLines, markdownContents } from "./memories-markdown";

describe("Markdown contents", () => {
	it("uses the actual GFM syntax tree, skips fenced code and disambiguates duplicate headings", () => {
		const source =
			"# Hello *world*\n\n## Hello world\n\n```md\n# Not heading\n```\n\nSetext title\n===\n\n> ### Nested `code`\n\n# 部署 &amp; worker\n\n# ![Alt](image.png) [Link](https://example.com)";
		expect(markdownContents(source).map(({ id, text, depth }) => ({ id, text, depth }))).toEqual([
			{ id: "heading-hello-world", text: "Hello world", depth: 1 },
			{ id: "heading-hello-world-1", text: "Hello world", depth: 2 },
			{ id: "heading-setext-title", text: "Setext title", depth: 1 },
			{ id: "heading-nested-code", text: "Nested code", depth: 3 },
			{ id: "heading-部署--worker", text: "部署 & worker", depth: 1 },
			{ id: "heading-alt-link", text: "Alt Link", depth: 1 },
		]);
		expect(markdownContents(source)[0]?.offset).toBe(0);
		expect(markdownContents("no heading")).toEqual([]);
		expect(markdownContents("# <span>Title</span>")[0]?.text).toBe("Title");
	});
});

describe("diff rendering model", () => {
	it("retains hunk headers, numbers unchanged/deleted/inserted lines and EOF markers", () => {
		expect(
			diffLines([
				{
					oldStart: 3,
					oldLines: 2,
					newStart: 3,
					newLines: 2,
					lines: [" same", "-old", "+new", "\\ No newline at end of file"],
				},
			]).map(({ key: _key, ...line }) => line),
		).toEqual([
			{ kind: "hunk", oldLine: null, newLine: null, text: "@@ -3,2 +3,2 @@" },
			{ kind: "same", oldLine: 3, newLine: 3, text: "same" },
			{ kind: "removed", oldLine: 4, newLine: null, text: "old" },
			{ kind: "added", oldLine: null, newLine: 4, text: "new" },
			{ kind: "meta", oldLine: null, newLine: null, text: "\\ No newline at end of file" },
		]);
		expect(diffLines([])).toEqual([]);
		expect(
			new Set(
				diffLines([
					{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+a"] },
				]).map((line) => line.key),
			).size,
		).toBe(3);
	});
});
