export type AttachmentRecord = {
	id: string;
	memory_id: string;
	r2_key: string;
	filename: string;
	content_type: string;
	size_bytes: number;
	sha256: string;
	created_by: string;
	created_at: number;
	deleted_at: number | null;
};

export type AttachmentPublic = {
	id: string;
	memory_id: string;
	filename: string;
	content_type: string;
	size_bytes: number;
	sha256: string;
	created_at: string;
	markdown?: string;
};

export function toPublicAttachment(row: AttachmentRecord, markdown = false): AttachmentPublic {
	const base: AttachmentPublic = {
		id: row.id,
		memory_id: row.memory_id,
		filename: row.filename,
		content_type: row.content_type,
		size_bytes: row.size_bytes,
		sha256: row.sha256,
		created_at: new Date(row.created_at).toISOString(),
	};
	if (markdown) {
		base.markdown = `![](octo://att/${row.id})`;
	}
	return base;
}
