export function l2Normalize(values: number[]): number[] {
	let scale = 0;
	for (const value of values) {
		if (!Number.isFinite(value)) throw new Error("vector values must be finite");
		scale = Math.max(scale, Math.abs(value));
	}
	if (scale === 0) throw new Error("zero vector");
	const scaled = values.map((value) => value / scale);
	const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0));
	return scaled.map((value) => value / norm);
}

export function dot(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		sum += (a[i] ?? 0) * (b[i] ?? 0);
	}
	return sum;
}

export function encodeFloat32Vector(values: number[]): Uint8Array {
	const buf = new ArrayBuffer(values.length * 4);
	const view = new DataView(buf);
	for (let i = 0; i < values.length; i++) {
		view.setFloat32(i * 4, values[i] ?? 0, true);
	}
	return new Uint8Array(buf);
}

export function decodeFloat32Vector(blob: ArrayBuffer | Uint8Array, dim: number): number[] {
	const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: number[] = [];
	for (let i = 0; i < dim; i++) {
		out.push(view.getFloat32(i * 4, true));
	}
	return out;
}

export function minMaxNormalize(scores: Map<string, number>): Map<string, number> {
	if (scores.size === 0) {
		return new Map();
	}
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const v of scores.values()) {
		min = Math.min(min, v);
		max = Math.max(max, v);
	}
	if (min === max) {
		const out = new Map<string, number>();
		for (const id of scores.keys()) {
			out.set(id, 1);
		}
		return out;
	}
	const span = max - min;
	const out = new Map<string, number>();
	for (const [id, v] of scores) {
		out.set(id, (v - min) / span);
	}
	return out;
}
