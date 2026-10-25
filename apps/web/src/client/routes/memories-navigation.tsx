import { Link, type LinkProps } from "react-router";

export function MemoryLink({
	memoryId,
	memoryTitle,
	children,
	...props
}: Omit<LinkProps, "to"> & { memoryId: string; memoryTitle: string }) {
	return (
		<Link {...props} to={`/memories/${encodeURIComponent(memoryId)}`} state={{ memoryTitle }}>
			{children}
		</Link>
	);
}
