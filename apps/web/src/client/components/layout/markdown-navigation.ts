export function navigateToMarkdownHeading(id: string): boolean {
	const heading = document.getElementById(id);
	if (!heading) return false;
	heading.focus({ preventScroll: true });
	heading.scrollIntoView({ block: "start" });
	return true;
}

export function restoreMarkdownHeading(hash: string): boolean {
	if (!hash.startsWith("#")) return false;
	try {
		return navigateToMarkdownHeading(decodeURIComponent(hash.slice(1)));
	} catch {
		return false;
	}
}

export function isCurrentMarkdownFragment(hash: string): boolean {
	try {
		return decodeURIComponent(window.location.hash) === decodeURIComponent(hash);
	} catch {
		return false;
	}
}

export function isPlainLinkClick(
	event: Pick<
		MouseEvent,
		"defaultPrevented" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
	>,
): boolean {
	return !(
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey
	);
}
