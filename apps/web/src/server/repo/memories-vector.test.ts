import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import { insertTinyProfile, openTestD1 } from "./__tests__/sqlite-d1";
import { normalizeVector, resolveVectorWrite, vectorBlob } from "./memories-vector";

describe("normalizeVector", () => {
	it("l2-normalizes finite non-zero vectors", () => {
		const out = normalizeVector([3, 4]);
		expect(out[0]).toBeCloseTo(0.6);
		expect(out[1]).toBeCloseTo(0.8);
		expect(vectorBlob(out).byteLength).toBe(8);
	});

	it("normalizes extreme finite vectors without overflow or underflow", () => {
		for (const scale of [1e200, 1e-200, Number.MAX_VALUE, Number.MIN_VALUE]) {
			const out = normalizeVector([scale, scale, 0]);
			expect(out[0]).toBeCloseTo(Math.SQRT1_2);
			expect(out[1]).toBeCloseTo(Math.SQRT1_2);
			expect(Math.hypot(...out)).toBeCloseTo(1);
		}
	});

	it("rejects zero and non-finite values", () => {
		expect(() => normalizeVector([0, 0])).toThrow(ApiError);
		expect(() => normalizeVector([1, Number.NaN])).toThrow(ApiError);
		expect(() => normalizeVector([Number.POSITIVE_INFINITY])).toThrow(ApiError);
	});
});

describe("resolveVectorWrite", () => {
	it("validates profile dims and unknown profiles", async () => {
		const db = openTestD1();
		await insertTinyProfile(db);
		const write = await resolveVectorWrite(db, { profile: "tiny-3", values: [1, 0, 0] });
		expect(write.dim).toBe(3);
		expect(write.profileId).toBe("tiny-3");
		await expect(resolveVectorWrite(db, { profile: "missing", values: [1] })).rejects.toMatchObject(
			{
				code: "validation_failed",
			},
		);
		await expect(
			resolveVectorWrite(db, { profile: "tiny-3", values: [1, 0] }),
		).rejects.toMatchObject({
			code: "vector_dimension_mismatch",
		});
	});
});
