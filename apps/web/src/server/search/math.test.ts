import { describe, expect, it } from "vitest";
import {
	decodeFloat32Vector,
	dot,
	encodeFloat32Vector,
	l2Normalize,
	minMaxNormalize,
} from "./math";

describe("l2Normalize", () => {
	it("normalizes to unit length", () => {
		const v = l2Normalize([3, 4]);
		expect(v[0]).toBeCloseTo(0.6);
		expect(v[1]).toBeCloseTo(0.8);
		expect(dot(v, v)).toBeCloseTo(1);
	});

	it.each([
		[3e300, 4e300],
		[3e-300, 4e-300],
		[Number.MIN_VALUE, Number.MIN_VALUE],
	])("normalizes finite magnitudes without overflow: %j", (...values) => {
		const result = l2Normalize(values);
		expect(result.every(Number.isFinite)).toBe(true);
		expect(dot(result, result)).toBeCloseTo(1, 12);
	});

	it.each([
		[Infinity, 1],
		[NaN, 1],
	])("rejects non-finite components: %j", (...values) => {
		expect(() => l2Normalize(values)).toThrow("finite");
	});

	it("rejects a zero vector", () => {
		expect(() => l2Normalize([0, 0])).toThrow("zero vector");
	});
});

describe("float32 vector blob", () => {
	it("round-trips values", () => {
		const values = [0.1, -2.5, 3.25];
		const blob = encodeFloat32Vector(values);
		const decoded = decodeFloat32Vector(blob, 3);
		for (let i = 0; i < values.length; i++) {
			expect(decoded[i]).toBeCloseTo(values[i] ?? 0);
		}
	});
});

describe("dot", () => {
	it("treats missing components as zero", () => {
		expect(dot([1, 2], [1])).toBe(1);
		expect(dot([], [3])).toBe(0);
	});
});

describe("decodeFloat32Vector", () => {
	it("accepts ArrayBuffer input", () => {
		const blob = encodeFloat32Vector([1, 2]);
		const buf = new Uint8Array(blob).buffer as ArrayBuffer;
		const decoded = decodeFloat32Vector(buf, 2);
		expect(decoded[0]).toBeCloseTo(1);
		expect(decoded[1]).toBeCloseTo(2);
	});
});

describe("minMaxNormalize", () => {
	it("returns an empty map for no scores", () => {
		expect(minMaxNormalize(new Map())).toEqual(new Map());
	});

	it("maps scores to 0..1", () => {
		const input = new Map([
			["a", 10],
			["b", 20],
			["c", 30],
		]);
		expect(minMaxNormalize(input)).toEqual(
			new Map([
				["a", 0],
				["b", 0.5],
				["c", 1],
			]),
		);
	});

	it("returns 1 for equal scores", () => {
		expect(minMaxNormalize(new Map([["x", 5]]))).toEqual(new Map([["x", 1]]));
	});
});
