import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import { Link, type LinkProps, useNavigate } from "react-router";

export function memoryTransition(id: string): CSSProperties {
	return { viewTransitionName: `memory-${id.replace(/[^A-Za-z0-9_-]/g, "-")}` };
}

export function MemoryLink({
	memoryId,
	memoryTitle,
	children,
	...props
}: Omit<LinkProps, "to"> & { memoryId: string; memoryTitle: string }) {
	const navigate = useNavigate();
	const to = `/memories/${encodeURIComponent(memoryId)}`;
	return (
		<Link
			{...props}
			to={to}
			state={{ memoryTitle }}
			style={memoryTransition(memoryId)}
			onClick={(event) => {
				props.onClick?.(event);
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey ||
					(props.target && props.target !== "_self") ||
					props.download !== undefined ||
					!document.startViewTransition ||
					window.matchMedia("(prefers-reduced-motion: reduce)").matches
				)
					return;
				event.preventDefault();
				const transition = document.startViewTransition(() => {
					flushSync(() => navigate(to, { state: { memoryTitle } }));
					document.querySelector(".octo-island")?.scrollTo(0, 0);
					window.scrollTo(0, 0);
				});
				void transition.finished.catch(() => undefined);
			}}
		>
			{children}
		</Link>
	);
}
