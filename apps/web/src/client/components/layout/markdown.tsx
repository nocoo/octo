import { Checkbox, Link } from "@nocoo/basalt";
import { Grid } from "@nocoo/basalt/components/grid";
import { TableOfContents, TableOfContentsItem } from "@nocoo/basalt/components/table-of-contents";
import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { type ContentsEntry, markdownContents } from "../../viewmodels/memories-markdown";
import {
	isCurrentMarkdownFragment,
	isPlainLinkClick,
	navigateToMarkdownHeading,
	restoreMarkdownHeading,
} from "./markdown-navigation";
import "./markdown.css";

export function MarkdownContents({
	entries,
	onNavigate,
}: {
	entries: ContentsEntry[];
	onNavigate?: (id: string) => void;
}) {
	return (
		<TableOfContents title="本页目录">
			{entries.map((entry) => (
				<TableOfContentsItem key={entry.id}>
					<Link
						href={`#${entry.id}`}
						onClick={(event) => {
							if (!isPlainLinkClick(event)) return;
							if (onNavigate) {
								event.preventDefault();
								onNavigate(entry.id);
							} else if (isCurrentMarkdownFragment(`#${entry.id}`)) {
								event.preventDefault();
								navigateToMarkdownHeading(entry.id);
							}
						}}
					>
						<span className="octo-memory-toc-indent" data-depth={entry.depth}>
							{entry.text || "未命名章节"}
						</span>
					</Link>
				</TableOfContentsItem>
			))}
		</TableOfContents>
	);
}

export function Markdown({
	source,
	hash,
	urls = {},
	onAttachment,
}: {
	source: string;
	hash?: string;
	urls?: Record<string, string>;
	onAttachment?: (id: string) => Promise<string>;
}) {
	const entries = useMemo(() => markdownContents(source), [source]);
	const restoredHash = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!hash) restoredHash.current = undefined;
		else if (hash !== restoredHash.current && entries.length && restoreMarkdownHeading(hash))
			restoredHash.current = hash;
	}, [hash, entries]);
	const components = useMemo<Components>(() => {
		const result: Components = {
			input: ({ checked }) => (
				<Checkbox
					checked={Boolean(checked)}
					disabled
					aria-label={checked ? "已完成任务" : "未完成任务"}
				/>
			),
			a: ({ node: _node, href, children, ...props }) => {
				const attachment = href?.match(/^octo:\/\/att\/([A-Za-z0-9_-]+)$/)?.[1];
				if (href?.startsWith("#")) {
					return (
						<Link
							{...props}
							href={href}
							onClick={(event) => {
								if (isPlainLinkClick(event) && isCurrentMarkdownFragment(href)) {
									event.preventDefault();
									restoreMarkdownHeading(href);
								}
							}}
						>
							{children}
						</Link>
					);
				}
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
					<span className="octo-muted">{alt || "正在加载附件"}</span>
				);
			},
		};
		for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
			const Tag = ({ h1: "h3", h2: "h4", h3: "h5", h4: "h6", h5: "h6", h6: "h6" } as const)[tag];
			result[tag] = ({ node, children, ...props }) => (
				<Tag
					{...props}
					tabIndex={-1}
					id={entries.find((entry) => entry.offset === node?.position?.start.offset)?.id}
				>
					{children}
				</Tag>
			);
		}
		return result;
	}, [entries, urls, onAttachment]);
	return (
		<Grid columns={1} gap="md" className="octo-markdown">
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
		</Grid>
	);
}
