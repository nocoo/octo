import { Checkbox } from "@nocoo/basalt";
import { TableOfContents, TableOfContentsItem } from "@nocoo/basalt/components/table-of-contents";
import { useEffect, useMemo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { type ContentsEntry, markdownContents } from "../../viewmodels/memories-markdown";
import "./markdown.css";

export function MarkdownContents({
	entries,
	onNavigate,
}: {
	entries: ContentsEntry[];
	onNavigate?: () => void;
}) {
	useEffect(() => {
		if (!onNavigate) return;
		window.addEventListener("hashchange", onNavigate);
		return () => window.removeEventListener("hashchange", onNavigate);
	}, [onNavigate]);
	return (
		<TableOfContents title="On this page">
			{entries.map((entry) => (
				<div key={entry.id} data-depth={entry.depth}>
					<TableOfContentsItem href={`#${entry.id}`}>
						{entry.text || "Untitled section"}
					</TableOfContentsItem>
				</div>
			))}
		</TableOfContents>
	);
}

export function Markdown({
	source,
	urls = {},
	onAttachment,
}: {
	source: string;
	urls?: Record<string, string>;
	onAttachment?: (id: string) => Promise<string>;
}) {
	const entries = useMemo(() => markdownContents(source), [source]);
	const components = useMemo<Components>(() => {
		const result: Components = {
			input: ({ checked }) => (
				<Checkbox
					checked={Boolean(checked)}
					disabled
					aria-label={checked ? "Completed task" : "Incomplete task"}
				/>
			),
			a: ({ node: _node, href, children, ...props }) => {
				const attachment = href?.match(/^octo:\/\/att\/([A-Za-z0-9_-]+)$/)?.[1];
				return (
					<a
						{...props}
						href={attachment ? urls[attachment] : href}
						rel="noreferrer noopener"
						onClick={
							attachment && onAttachment
								? (event) => {
										event.preventDefault();
										void onAttachment(attachment)
											.then((url) => window.location.assign(url))
											.catch(() => undefined);
									}
								: undefined
						}
					>
						{children}
					</a>
				);
			},
			img: ({ node: _node, src, alt, ...props }) => {
				const attachment =
					typeof src === "string" ? src.match(/^octo:\/\/att\/([A-Za-z0-9_-]+)$/)?.[1] : undefined;
				const resolved = attachment ? urls[attachment] : src;
				return resolved ? (
					<img
						{...props}
						src={resolved}
						alt={alt ?? ""}
						loading="lazy"
						referrerPolicy="no-referrer"
						onError={
							attachment && onAttachment
								? () => {
										void onAttachment(attachment).catch(() => undefined);
									}
								: undefined
						}
					/>
				) : (
					<span className="octo-muted">{alt || "Attachment loading"}</span>
				);
			},
		};
		for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
			const Tag = tag;
			result[tag] = ({ node, children, ...props }) => (
				<Tag
					{...props}
					id={entries.find((entry) => entry.offset === node?.position?.start.offset)?.id}
				>
					{children}
				</Tag>
			);
		}
		return result;
	}, [entries, urls, onAttachment]);
	return (
		<article className="octo-markdown">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
				components={components}
				urlTransform={(url) =>
					/^octo:\/\/att\/[A-Za-z0-9_-]+$/.test(url) ? url : defaultUrlTransform(url)
				}
			>
				{source}
			</ReactMarkdown>
		</article>
	);
}
