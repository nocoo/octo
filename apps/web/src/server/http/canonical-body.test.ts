import { describe, expect, it } from "vitest";
import { canonicalBody } from "./canonical-body";

describe("canonicalBody", () => {
	it("preserves raw text for non-json", () => {
		expect(canonicalBody("plain")).toBe("plain");
	});

	it("sorts json object keys recursively", () => {
		expect(canonicalBody('{"b":2,"a":{"d":4,"c":3}}')).toBe('{"a":{"c":3,"d":4},"b":2}');
	});

	it("uses empty string for empty body", () => {
		expect(canonicalBody("")).toBe("");
	});

	it("canonicalizes objects inside arrays", () => {
		expect(canonicalBody('[{"b":2,"a":1}]')).toBe('[{"a":1,"b":2}]');
	});

	it.each(["__proto__", "constructor", "prototype"])("preserves %s in the hash input", (key) => {
		const raw = `{"${key}":{"polluted":true},"a":1}`;
		expect(JSON.parse(canonicalBody(raw))).toEqual(JSON.parse(raw));
		expect(canonicalBody(raw)).not.toBe(canonicalBody('{"a":1}'));
	});
});
