import { ApiError } from "../lib/errors";

export type EmbeddingProfile = {
	id: string;
	model: string;
	dims: number;
};

export type VectorWrite = {
	profileId: string;
	embeddingModel: string;
	dim: number;
	vector: ArrayBuffer;
};

export function normalizeVector(values: number[]): Float32Array {
	let sum = 0;
	for (const value of values) {
		if (!Number.isFinite(value)) {
			throw new ApiError("validation_failed", "vector values must be finite");
		}
		sum += value * value;
	}
	const norm = Math.sqrt(sum);
	if (norm === 0) {
		throw new ApiError("validation_failed", "vector must be non-zero");
	}
	const out = new Float32Array(values.length);
	for (let i = 0; i < values.length; i += 1) {
		out[i] = (values[i] ?? 0) / norm;
	}
	return out;
}

export function vectorBlob(values: Float32Array): ArrayBuffer {
	const copy = new ArrayBuffer(values.byteLength);
	new Uint8Array(copy).set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
	return copy;
}

export async function resolveVectorWrite(
	db: D1Database,
	input: { profile: string; values: number[] },
): Promise<VectorWrite> {
	const profile = await db
		.prepare("SELECT id, model, dims FROM embedding_profiles WHERE id = ?")
		.bind(input.profile)
		.first<EmbeddingProfile>();
	if (!profile) {
		throw new ApiError("validation_failed", "unknown embedding profile");
	}
	if (input.values.length !== profile.dims) {
		throw new ApiError("vector_dimension_mismatch", "vector length does not match profile dims", {
			expected: profile.dims,
			actual: input.values.length,
		});
	}
	const normalized = normalizeVector(input.values);
	return {
		profileId: profile.id,
		embeddingModel: profile.model,
		dim: profile.dims,
		vector: vectorBlob(normalized),
	};
}
