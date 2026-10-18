import { describe, expect, it } from "vitest";
import { vectorErrorDetails } from "./vector-errors";

describe("vector error redaction", () => {
	it.each([null, undefined, "private body", {}, { message: 42 }, new Error()])(
		"redacts missing or nonstandard diagnostics: %j",
		(error) => {
			expect(vectorErrorDetails(error)).toMatchObject({ code: null, error_message: "[redacted]" });
		},
	);
	it.each(["secret-token", -1, 100_000_000, 1.5, Number.NaN])("redacts unsafe code %s", (code) => {
		expect(vectorErrorDetails({ code }).code).toBeNull();
	});
	it.each(["VECTOR_DELETE_ERROR", "ETIMEDOUT", 429])("retains known code %s", (code) => {
		expect(vectorErrorDetails({ code }).code).toBe(code);
	});
	it.each([
		"internal server error",
		"service unavailable",
		"too many requests",
		"rate limit exceeded",
		"unauthorized",
		"forbidden",
		"request timed out",
		"network error",
		"VECTOR_DELETE_ERROR (code = 10000)",
	])("retains only public diagnostic prefixes: %s", (message) => {
		expect(vectorErrorDetails(new Error(message)).error_message).toBe(message);
		const safe = vectorErrorDetails(
			new Error(`${message}: body=private body; sk-secret ${"x".repeat(400)}`),
		);
		expect(safe.error_message).toBe(`${message} [redacted]`);
		expect(safe.error_message.length).toBeLessThanOrEqual(300);
	});
});
