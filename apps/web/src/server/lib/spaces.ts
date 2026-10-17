export async function resolveSpaceIdBySlug(db: D1Database, slug: string): Promise<string | null> {
	const row = await db
		.prepare("SELECT id FROM spaces WHERE slug = ?")
		.bind(slug)
		.first<{ id: string }>();
	return row?.id ?? null;
}
