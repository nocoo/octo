import type { TagWrite } from "../tags";

export async function commitTagWrite<T>(db: D1Database, pending: Promise<TagWrite<T>>): Promise<T> {
	const write = await pending;
	try {
		await db.batch(write.statements);
	} catch (err) {
		throw write.mapError(err) ?? err;
	}
	return write.value;
}
