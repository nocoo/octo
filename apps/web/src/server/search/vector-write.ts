import { encodeFloat32Vector, l2Normalize } from "./math";

export type EmbeddingProfile = {
	id: string;
	model: string;
	dims: number;
};

export async function loadEmbeddingProfile(
	db: D1Database,
	profileId: string,
): Promise<EmbeddingProfile | null> {
	const row = await db
		.prepare("SELECT id, model, dims FROM embedding_profiles WHERE id = ? AND active = 1 LIMIT 1")
		.bind(profileId)
		.first<{ id: string; model: string; dims: number }>();
	return row ?? null;
}

export function assertVectorValues(values: number[], dims: number): number[] {
	if (values.length !== dims) {
		const err = new Error("vector dimension mismatch");
		(err as Error & { code: string }).code = "vector_dimension_mismatch";
		throw err;
	}
	if (!values.every((v) => Number.isFinite(v))) {
		throw new Error("vector values must be finite");
	}
	return l2Normalize(values);
}

export function vectorBlobFromValues(values: number[], dims: number): Uint8Array {
	const normalized = assertVectorValues(values, dims);
	return encodeFloat32Vector(normalized);
}
