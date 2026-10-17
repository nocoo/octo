import { describe, expect, it } from "vitest";
import { requestHash } from "./request-hash";

describe("requestHash", () => {
	it("binds the optimistic-concurrency header to the request", async () => {
		const first = await requestHash("PATCH", "/api/v1/memories/id", '{"title":"changed"}', "1");
		expect(await requestHash("PATCH", "/api/v1/memories/id", '{"title":"changed"}', "2")).not.toBe(
			first,
		);
		expect(await requestHash("PATCH", "/api/v1/memories/id", '{"title":"changed"}')).not.toBe(
			first,
		);
	});
	it("hashes method path and canonical body", async () => {
		const a = await requestHash("POST", "/api/v1/memories", '{"b":1,"a":2}');
		const b = await requestHash("POST", "/api/v1/memories", '{"a":2,"b":1}');
		expect(a).toBe(b);
		const c = await requestHash("PATCH", "/api/v1/memories", '{"a":2,"b":1}');
		expect(c).not.toBe(a);
	});
});
