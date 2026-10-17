import { describe, expect, it } from "vitest";
import { newRequestId, withOctoHeaders } from "./request";

describe("newRequestId", () => {
	it("reuses a valid incoming id", () => {
		const id = newRequestId(
			new Request("http://octo.local", { headers: { "X-Request-Id": "abc" } }),
		);
		expect(id).toBe("abc");
	});

	it("generates a uuid when missing or too long", () => {
		expect(newRequestId(new Request("http://octo.local"))).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		const long = "x".repeat(129);
		expect(
			newRequestId(new Request("http://octo.local", { headers: { "X-Request-Id": long } })),
		).not.toBe(long);
	});
});

describe("withOctoHeaders", () => {
	it("sets request and version headers", () => {
		const res = withOctoHeaders(new Response("ok"), "rid", "0.1.0");
		expect(res.headers.get("X-Request-Id")).toBe("rid");
		expect(res.headers.get("X-Octo-Version")).toBe("0.1.0");
	});
});
