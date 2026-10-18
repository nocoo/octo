import { describe, expect, it } from "vitest";
import { z } from "zod";
import { memoryCreateSchema, memoryPatchSchema } from "./memory";

const create = {
	space: "kb-bot",
	title: "Caddy",
	body: "ports",
	type: "procedure" as const,
	tags: ["infra"],
};

describe("memoryCreateSchema", () => {
	it("accepts a minimal create body", () => {
		expect(memoryCreateSchema.parse(create)).toEqual(create);
	});

	it("rejects unknown fields", () => {
		expect(memoryCreateSchema.safeParse({ ...create, extra: 1 }).success).toBe(false);
	});

	it("requires ISO-8601 UTC event_time with a Z suffix", () => {
		expect(
			memoryCreateSchema.safeParse({ ...create, event_time: "2026-01-01T00:00:00Z" }).success,
		).toBe(true);
		expect(memoryCreateSchema.safeParse({ ...create, event_time: "not-a-date" }).success).toBe(
			false,
		);
		expect(memoryCreateSchema.safeParse({ ...create, event_time: "yesterday" }).success).toBe(
			false,
		);
		expect(
			memoryCreateSchema.safeParse({ ...create, event_time: "2026-01-01T00:00:00+08:00" }).success,
		).toBe(false);
		expect(
			memoryCreateSchema.safeParse({ ...create, event_time: "2026-01-01T00:00:00" }).success,
		).toBe(false);
		expect(
			memoryCreateSchema.safeParse({ ...create, event_time: "2026-13-01T00:00:00Z" }).success,
		).toBe(false);
	});

	it("limits body by UTF-8 bytes, not UTF-16 length", () => {
		expect(memoryCreateSchema.safeParse({ ...create, body: "a".repeat(1_000_000) }).success).toBe(
			true,
		);
		expect(memoryCreateSchema.safeParse({ ...create, body: "a".repeat(1_000_001) }).success).toBe(
			false,
		);
		expect(memoryCreateSchema.safeParse({ ...create, body: "你".repeat(333_333) }).success).toBe(
			true,
		);
		expect(memoryCreateSchema.safeParse({ ...create, body: "你".repeat(333_334) }).success).toBe(
			false,
		);
	});
});

describe("memoryPatchSchema", () => {
	it("accepts a partial patch", () => {
		expect(memoryPatchSchema.parse({ title: "new" })).toEqual({ title: "new" });
	});

	it("rejects an empty patch", () => {
		expect(memoryPatchSchema.safeParse({}).success).toBe(false);
	});

	it("allows null event_time and rejects non-UTC timestamps", () => {
		expect(memoryPatchSchema.safeParse({ event_time: null }).success).toBe(true);
		expect(memoryPatchSchema.safeParse({ event_time: "2026-01-01T00:00:00Z" }).success).toBe(true);
		expect(memoryPatchSchema.safeParse({ event_time: "yesterday" }).success).toBe(false);
		expect(memoryPatchSchema.safeParse({ body: "你".repeat(333_334) }).success).toBe(false);
	});
});

describe.each([
	["create", memoryCreateSchema, create],
	["patch", memoryPatchSchema, { title: "new" }],
] as const)("%s importance", (_name, schema, input) => {
	it.each([0, 0.5, 1])("accepts importance %s", (importance) => {
		expect(schema.safeParse({ ...input, importance }).success).toBe(true);
	});
	it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.5"])(
		"rejects importance %s outside the numeric 0-1 range",
		(importance) => {
			expect(schema.safeParse({ ...input, importance }).success).toBe(false);
		},
	);
	it("describes the inclusive importance range in generated schemas", () => {
		expect(z.toJSONSchema(schema).properties?.importance).toMatchObject({
			minimum: 0,
			maximum: 1,
			description: expect.stringContaining("0 to 1"),
		});
	});
});
