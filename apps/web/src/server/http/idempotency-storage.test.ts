import { describe, expect, it } from "vitest";
import { responseChunks } from "./idempotency-storage";

describe("response chunks", () => {
	it.each(["", "{}", "漢😀".repeat(100_000)])(
		"round trips without splitting unicode scalars",
		(body) => {
			const chunks = responseChunks(body);
			expect(chunks.join("")).toBe(body);
			expect(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 240_000)).toBe(true);
			expect(
				chunks.every(
					(chunk) => new TextDecoder().decode(new TextEncoder().encode(chunk)) === chunk,
				),
			).toBe(true);
		},
	);
});
