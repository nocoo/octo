import { describe, expect, it } from "vitest";
import { parseJsonBody } from "./json-body";

describe("parseJsonBody", () => {
	it("parses json and rejects invalid input", () => {
		expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
		expect(parseJsonBody("")).toEqual({});
		expect(() => parseJsonBody("{")).toThrow(/invalid json body/);
	});
});
