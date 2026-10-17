export function contentDispositionFilename(filename: string): string {
	const safe = filename.replace(/[\r\n"\\]/g, "_");
	return `filename="${safe}"`;
}

export function attachmentDisposition(filename: string, contentType: string): string {
	const mode = contentType === "image/svg+xml" ? "attachment" : "inline";
	return `${mode}; ${contentDispositionFilename(filename)}`;
}
