import { describe, expect, it } from "vitest";
import { highlightSnippet } from "./snippet";

describe("highlightSnippet", () => {
	it("wraps the first matching term", () => {
		expect(highlightSnippet("hello 部署 world", ["部署"])).toContain("<mark>部署</mark>");
	});

	it("truncates long bodies", () => {
		const text = "x".repeat(300);
		expect(highlightSnippet(text, []).endsWith("…")).toBe(true);
	});

	it("keeps short bodies without ellipsis when nothing matches", () => {
		expect(highlightSnippet("short", ["nope"])).toBe("short");
	});

	it("handles matches at the start of the body", () => {
		expect(highlightSnippet("alpha beta", ["alpha"])).toBe("<mark>alpha</mark> beta");
	});

	it("picks the earliest matching term", () => {
		expect(highlightSnippet("alpha beta gamma", ["beta", "gamma"])).toContain("<mark>beta</mark>");
	});
});
