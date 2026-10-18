import { describe, expect, test } from "bun:test";
import { indexText, tokenizeQuery } from "../apps/web/src/server/search/tokenizer";
import {
	assertCrossIcuSample,
	CROSS_ICU,
	corpusRow,
	percentile,
	seedWordFields,
	sourceManifest,
	summarize,
} from "./word-search-lib";

describe("word-search benchmark helpers", () => {
	test("separates source paths from digest labels and preserves every hash", () => {
		const hashes = { "auth/api-key.ts": "a".repeat(64), "search/tokenizer.ts": "b".repeat(64) };
		const manifest = sourceManifest(hashes);
		expect(manifest).toEqual([
			{ path: "auth/api-key.ts", sha256: hashes["auth/api-key.ts"] },
			{ path: "search/tokenizer.ts", sha256: hashes["search/tokenizer.ts"] },
		]);
		expect(Object.fromEntries(manifest.map(({ path, sha256 }) => [path, sha256]))).toEqual(hashes);
		expect(sourceManifest({})).toEqual([]);
	});
	test("uses nearest-rank percentiles and rejects missing measurements", () => {
		expect(percentile([9, 1, 5, 3, 7], 0.5)).toBe(5);
		expect(
			percentile(
				Array.from({ length: 30 }, (_, index) => index + 1),
				0.95,
			),
		).toBe(29);
		expect(() => percentile([], 0.5)).toThrow();
		expect(summarize([2, 4, 6])).toEqual({ count: 3, min: 2, p50: 4, p95: 6, max: 6, mean: 4 });
	});

	test("generates deterministic mixed-language rows and an oldest recall sentinel", () => {
		expect(corpusRow(17)).toEqual(corpusRow(17));
		expect(corpusRow(0).body).toContain("他早上只喝黑咖啡");
		expect(corpusRow(999).updated_at).toBeGreaterThan(corpusRow(0).updated_at);
		expect(new Set(Array.from({ length: 1_000 }, (_, index) => corpusRow(index).id)).size).toBe(
			1_000,
		);
		expect(corpusRow(17).body).toMatch(/\p{Script=Han}/u);
		expect(corpusRow(17).body).toMatch(/[a-zA-Z]/);
	});

	test("reserves an old contiguous compound target behind more than 50 separated distractors", () => {
		const target = corpusRow(CROSS_ICU.targetIndex);
		expect(target.body).toContain(CROSS_ICU.query);
		expect(CROSS_ICU.distractorCount).toBeGreaterThan(50);
		for (let index = 1; index <= CROSS_ICU.distractorCount; index++) {
			const distractor = corpusRow(index);
			expect(
				[distractor.title, distractor.body, distractor.tag].some((field) =>
					field.includes(CROSS_ICU.query),
				),
			).toBe(false);
			for (const character of CROSS_ICU.query) expect(distractor.title).toContain(character);
		}
		expect(corpusRow(999).updated_at).toBeGreaterThan(target.updated_at + 500_000);
		expect(corpusRow(0).body).toContain("他早上只喝黑咖啡");
	});

	test("forces only the target seed compound token to be absent while retaining real unigram output", () => {
		const target = corpusRow(CROSS_ICU.targetIndex);
		const indexText = (text: string) =>
			text.includes(CROSS_ICU.query) ? "migration 云桥 云 桥" : text;
		const fields = seedWordFields(target, indexText);
		expect(fields.word_body).toBe("migration 云 桥");
		expect(fields.word_title).toBe(target.title);
		expect(fields.word_tags).toBe(target.tag);
		expect(seedWordFields({ ...target, id: "ordinary-row" }, indexText).word_body).toBe(
			"migration 云桥 云 桥",
		);
		expect(seedWordFields(target, () => "migration 云 桥").word_body).toBe("migration 云 桥");
		expect(() => seedWordFields(target, () => "云桥")).toThrow("unigram");
	});

	test("accepts only a real empty-direct then verified fallback trace with exact target recall", () => {
		const sample = {
			hits: 1,
			first_id: corpusRow(CROSS_ICU.targetIndex).id,
			partial: false,
			traces: [
				{
					sql: "SELECT id FROM memories_words_fts WHERE memories_words_fts MATCH ? LIMIT ?",
					result_rows: 0,
				},
				{
					sql: "SELECT id FROM memories_words_fts WHERE memories_words_fts MATCH ? AND instr(m.title, term.value) > 0 ORDER BY score LIMIT ?",
					result_rows: 1,
				},
			],
		};
		expect(() => assertCrossIcuSample(sample)).not.toThrow();
		expect(() => assertCrossIcuSample({ ...sample, first_id: "distractor" })).toThrow();
		expect(() => assertCrossIcuSample({ ...sample, hits: 2 })).toThrow();
		expect(() => assertCrossIcuSample({ ...sample, partial: true })).toThrow();
		expect(() => assertCrossIcuSample({ ...sample, traces: sample.traces.slice(1) })).toThrow();
		expect(() =>
			assertCrossIcuSample({
				...sample,
				traces: [
					{ ...sample.traces[0], sql: "direct", result_rows: 1 },
					sample.traces[1] as { sql: string; result_rows: number },
				],
			}),
		).toThrow();
		expect(() =>
			assertCrossIcuSample({
				...sample,
				traces: [
					{ sql: "direct", result_rows: 0 },
					{ sql: "SELECT id LIMIT ? /* instr(m.title, term.value) */", result_rows: 1 },
				],
			}),
		).toThrow();
	});

	test("keeps the forced seed and query contract with the actual product tokenizer", () => {
		const target = corpusRow(CROSS_ICU.targetIndex);
		const fields = seedWordFields(target, indexText);
		expect(tokenizeQuery(CROSS_ICU.query)).toEqual([CROSS_ICU.query]);
		expect(fields.word_body.split(" ")).not.toContain(CROSS_ICU.query);
		for (const character of CROSS_ICU.query)
			expect(fields.word_body.split(" ")).toContain(character);
		expect(fields.word_title).toBe(indexText(target.title));
		expect(fields.word_tags).toBe(indexText(target.tag));
		const ordinary = corpusRow(50000);
		expect(seedWordFields(ordinary, indexText)).toEqual({
			word_title: indexText(ordinary.title),
			word_body: indexText(ordinary.body),
			word_tags: indexText(ordinary.tag),
		});
	});
});
