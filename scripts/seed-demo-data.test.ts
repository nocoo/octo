import { describe, expect, it } from "vitest";
import { MEMORY_TYPES, memoryCreateSchema } from "../apps/web/src/lib/schema/memory";
import { demoMemories, demoSpaces } from "./seed-demo-data";

describe("synthetic demo catalogue", () => {
	it("populates shared tags across spaces while retaining untagged cases", () => {
		expect(
			demoMemories.filter(({ create }) => create.tags.length > 0).length,
		).toBeGreaterThanOrEqual(75);
		const tags = new Map<string, Set<string>>();
		for (const { create } of demoMemories) {
			for (const tag of create.tags) {
				const spaces = tags.get(tag) ?? new Set<string>();
				spaces.add(create.space);
				tags.set(tag, spaces);
			}
		}
		expect(tags.size).toBeGreaterThanOrEqual(25);
		expect([...tags.values()].some((spaces) => spaces.size === 6)).toBe(true);
		expect(demoMemories.some(({ create }) => create.tags.length === 0)).toBe(true);
	});
	it("contains 90 uniquely keyed memories, 15 per space, with 84 active and 6 trashed", () => {
		expect(demoSpaces).toHaveLength(6);
		expect(demoMemories).toHaveLength(90);
		expect(new Set(demoMemories.map((memory) => memory.key)).size).toBe(90);
		for (const space of demoSpaces) {
			const memories = demoMemories.filter((memory) => memory.create.space === space.slug);
			expect(memories).toHaveLength(15);
			expect(memories.filter((memory) => !memory.trash)).toHaveLength(14);
		}
		expect(demoMemories.filter((memory) => memory.trash)).toHaveLength(6);
	});

	it("parses every create payload and covers every memory type", () => {
		for (const memory of demoMemories) {
			expect(memoryCreateSchema.safeParse(memory.create).success, memory.key).toBe(true);
		}
		expect(new Set(demoMemories.map((memory) => memory.create.type))).toEqual(
			new Set(MEMORY_TYPES),
		);
	});

	it("provides varied content, metadata, history, and safe SVG attachments", () => {
		const bodies = demoMemories.map(({ create }) => create.body);
		const active = demoMemories.filter((memory) => !memory.trash);
		const effectiveBody = (memory: (typeof demoMemories)[number]) =>
			memory.revision?.body ?? memory.create.body;
		expect(active.filter((memory) => effectiveBody(memory).length === 0)).toHaveLength(1);
		expect(new Set(bodies).size).toBeGreaterThanOrEqual(80);
		expect(active.some((memory) => effectiveBody(memory).length > 8000)).toBe(true);
		expect(demoMemories.some((memory) => !memory.trash && memory.create.title.length > 100)).toBe(
			true,
		);
		expect(
			active.some(
				(memory) =>
					effectiveBody(memory).length > 8000 &&
					effectiveBody(memory).includes("##") &&
					effectiveBody(memory).includes("|"),
			),
		).toBe(true);
		expect(
			demoMemories.filter(({ create }) => /[\u3400-\u9fff]/u.test(create.title)).length,
		).toBeGreaterThanOrEqual(20);
		expect(
			demoMemories.some(({ create }) => /[\u3400-\u9fff]/u.test(`${create.title}${create.body}`)),
		).toBe(true);
		expect(
			demoMemories.some(
				({ create }) => /[A-Za-z]/u.test(create.body) && /[\u3400-\u9fff]/u.test(create.body),
			),
		).toBe(true);
		expect(demoMemories.some(({ create }) => create.tags.length === 0)).toBe(true);
		expect(demoMemories.some(({ create }) => create.tags.length >= 10)).toBe(true);
		expect(demoMemories.some(({ create }) => create.importance === 0)).toBe(true);
		expect(demoMemories.some(({ create }) => create.importance === 1)).toBe(true);
		expect(demoMemories.some(({ create }) => create.importance === undefined)).toBe(true);
		expect(demoMemories.some(({ create }) => create.event_time === undefined)).toBe(true);
		expect(
			new Set(
				demoMemories.flatMap(({ create }) =>
					create.event_time ? [create.event_time.slice(0, 7)] : [],
				),
			).size,
		).toBeGreaterThan(3);
		const revised = demoMemories.filter((memory) => memory.revision);
		expect(revised.length).toBeGreaterThanOrEqual(8);
		for (const memory of revised) expect(memory.revision?.body).not.toBe(memory.create.body);
		expect(demoMemories.filter((memory) => memory.attachment).length).toBeGreaterThanOrEqual(6);
		expect(demoMemories.filter((memory) => memory.attachment).length).toBeLessThanOrEqual(8);
		expect(
			new Set(
				demoMemories.flatMap((memory) => (memory.attachment ? [memory.attachment.type] : [])),
			),
		).toEqual(new Set(["image/svg+xml"]));
		for (const memory of demoMemories.filter((item) => item.attachment)) {
			expect(memory.attachment?.name).toMatch(/\.svg$/u);
			expect(memory.attachment?.body).toMatch(/^<svg\b/u);
			expect(memory.attachment?.body).not.toMatch(
				/<script\b|<foreignObject\b|(?:href|xlink:href)=/iu,
			);
		}
	});

	it("uses rich, inert content without external image URLs", () => {
		const content = demoMemories.map(({ create }) => create.body).join("\n");
		expect(content).toMatch(/\|.*\|/u);
		expect(content).toMatch(/```/u);
		expect(content).toMatch(/^>/mu);
		expect(content).toMatch(/\[[^\]]+\]\(https:\/\/example\.invalid\//u);
		expect(content).toMatch(/[!?！？，。…“”]/u);
		expect(content).toMatch(/[🌱🌿🍅🥬🪴]/u);
		expect(content).not.toMatch(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp|avif)(?:\?|\)|$)/iu);
		expect(content).not.toMatch(/<script\b|javascript:/iu);
	});

	it("uses fixed historic, current, and future event dates", () => {
		const dates = demoMemories.flatMap(({ create }) =>
			create.event_time ? [create.event_time] : [],
		);
		expect(dates.some((date) => date < "2026-01-01T00:00:00.000Z")).toBe(true);
		expect(dates).toContain("2026-10-21T12:00:00.000Z");
		expect(dates.some((date) => date > "2026-12-31T23:59:59.999Z")).toBe(true);
		expect(demoMemories.some(({ create }) => create.event_time === undefined)).toBe(true);
	});
});
