import { describe, expect, it } from "vitest";
import { memoryCreateSchema } from "../../lib/schema/memory";
import { ApiError } from "./errors";
import { parseStrict } from "./validate";

describe("parseStrict", () => {
	it("returns parsed data", () => {
		const body = {
			space: "kb-bot",
			title: "t",
			body: "b",
			type: "note" as const,
			tags: [],
		};
		expect(parseStrict(memoryCreateSchema, body)).toEqual(body);
	});

	it("throws validation_failed with issue paths", () => {
		try {
			parseStrict(memoryCreateSchema, { extra: true });
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			const api = err as ApiError;
			expect(api.code).toBe("validation_failed");
			expect(api.details).toMatchObject({ issues: expect.any(Array) });
		}
	});
});
