import { describe, expect, it } from "vitest";
import { d1Results } from "./d1";

describe("d1Results", () => {
	it("normalizes missing and present result sets", () => {
		expect(d1Results(undefined)).toEqual([]);
		expect(d1Results({})).toEqual([]);
		expect(d1Results({ results: [] })).toEqual([]);
		expect(d1Results({ results: [{ id: "x" }] })).toEqual([{ id: "x" }]);
	});
});
