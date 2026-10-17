export const ATTACHMENT_CONTENT_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/svg+xml",
	"application/pdf",
] as const;

export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number];

const ALLOWED = new Set<string>(ATTACHMENT_CONTENT_TYPES);

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export function normalizeContentType(value: string): string {
	return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isAllowedAttachmentType(value: string): value is AttachmentContentType {
	return ALLOWED.has(normalizeContentType(value));
}
