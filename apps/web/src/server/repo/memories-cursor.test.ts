import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/errors";
import {
	decodeCursor,
	encodeCursor,
	parseChangeCursor,
	parseLimit,
	parseMemoryCursor,
} from "./memories-cursor";

describe("cursors", () => {
	it("round-trips opaque payloads", () => {
		const encoded = encodeCursor({ u: 9, i: "abc" });
		expect(encoded).not.toContain("+");
		expect(encoded).not.toContain("/");
		expect(encoded).not.toContain("=");
		expect(decodeCursor(encoded)).toEqual({ u: 9, i: "abc" });
		expect(parseMemoryCursor(encoded)).toEqual({ u: 9, i: "abc" });
		expect(parseChangeCursor(encodeCursor({ s: 0 }))).toEqual({ s: 0 });
	});

	it("rejects invalid cursors and limits", () => {
		expect(() => decodeCursor("!!!")).toThrow(ApiError);
		expect(() => parseMemoryCursor(encodeCursor({ s: 1 }))).toThrow();
		expect(parseLimit(null)).toBe(50);
		expect(parseLimit("")).toBe(50);
		expect(parseLimit("10")).toBe(10);
		expect(() => parseLimit("0")).toThrow(ApiError);
		expect(() => parseLimit("201")).toThrow(ApiError);
		expect(() => parseLimit("nope")).toThrow(ApiError);
	});
});
