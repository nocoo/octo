export function normalizeTagName(name: string): string {
	return name
		.trim()
		.normalize("NFKC")
		.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}
