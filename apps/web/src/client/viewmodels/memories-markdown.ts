import GithubSlugger from "github-slugger";
import { toString as markdownText } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { MemoryDiff } from "./memories";

export interface ContentsEntry {
	id: string;
	text: string;
	depth: number;
	offset: number;
}

export function markdownContents(source: string): ContentsEntry[] {
	const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
	const slugger = new GithubSlugger();
	const entries: ContentsEntry[] = [];
	type Node = {
		type: string;
		depth?: number | undefined;
		position?: { start: { offset?: number | undefined } } | undefined;
		children?: Node[] | undefined;
	};
	function visit(node: Node): void {
		if (node.type === "heading") {
			const text = markdownText(node, { includeHtml: false });
			const position = node.position as { start: { offset: number } };
			entries.push({
				id: `heading-${slugger.slug(text)}`,
				text,
				depth: node.depth as number,
				offset: position.start.offset,
			});
		}
		for (const child of node.children ?? []) visit(child);
	}
	visit(tree);
	return entries;
}

export interface DiffLine {
	kind: "hunk" | "same" | "removed" | "added" | "meta";
	oldLine: number | null;
	newLine: number | null;
	text: string;
}

export function diffLines(hunks: MemoryDiff["body"]["hunks"]): (DiffLine & { key: string })[] {
	const rows: DiffLine[] = [];
	for (const hunk of hunks) {
		rows.push({
			kind: "hunk",
			oldLine: null,
			newLine: null,
			text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
		});
		let oldLine = hunk.oldStart;
		let newLine = hunk.newStart;
		for (const line of hunk.lines) {
			if (line.startsWith("-"))
				rows.push({ kind: "removed", oldLine: oldLine++, newLine: null, text: line.slice(1) });
			else if (line.startsWith("+"))
				rows.push({ kind: "added", oldLine: null, newLine: newLine++, text: line.slice(1) });
			else if (line.startsWith(" "))
				rows.push({ kind: "same", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
			else rows.push({ kind: "meta", oldLine: null, newLine: null, text: line });
		}
	}
	let offset = 0;
	return rows.map((row) => {
		const key = String(offset);
		offset += row.text.length + 1;
		return { ...row, key };
	});
}
