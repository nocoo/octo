const SEGMENTER = new Intl.Segmenter("zh", { granularity: "word" });
const HAN_RUN = /\p{Script=Han}+/gu;
const SCRIPT_RUN = /\p{Script=Han}+|[^\p{Script=Han}]+/gu;
const STOPWORDS = new Set(
	`a an and are as at be been being but by can could did do does doing for from
had has have having he her hers herself him himself his how i if in into is it its itself
me my myself of on or our ours ourselves she should so than that the their theirs them
themselves then there these they this those to us was we were what when where which
who whom whose why will with would you your yours yourself yourselves
什么 什么时候 多久 怎么 怎样 如何 为什么 为何 哪里 哪儿 在哪 哪个 哪些 几岁 几 多少
是不是 有没有 请问 他 她 它 你 您 我 我们 你们 他们 她们 它们
哪 吗 呢 吧 啊 的 了 着 是 有 没有 在 和 与 或 一下`.split(/\s+/),
);

export function segmentText(text: string): string[] {
	return (text.match(SCRIPT_RUN) ?? []).flatMap((run) => {
		const words: string[] = [];
		let end = -1;
		for (const part of SEGMENTER.segment(run)) {
			if (!part.isWordLike) continue;
			const previous = words.at(-1);
			if (
				previous &&
				/^[\p{Script=Han}]$/u.test(previous) &&
				/^[\p{Script=Han}]$/u.test(part.segment) &&
				!STOPWORDS.has(previous) &&
				!STOPWORDS.has(part.segment) &&
				end === part.index
			) {
				words[words.length - 1] = previous + part.segment;
			} else words.push(part.segment);
			end = part.index + part.segment.length;
		}
		return words;
	});
}

export function indexText(text: string): string {
	const words = segmentText(text);
	const extra = new Set<string>();
	const existing = new Set(words);
	for (const run of text.match(HAN_RUN) ?? []) {
		for (const character of run) {
			if (!existing.has(character)) extra.add(character);
		}
	}
	return [...words, ...extra].join(" ");
}

export function tokenizeQuery(query: string): string[] {
	const words = segmentText(query);
	const meaningful = words.filter((word) => !STOPWORDS.has(word.toLowerCase()));
	return [...new Set(meaningful.length ? meaningful : words)];
}

export function escapeFtsToken(token: string): string {
	return `"${token.replaceAll('"', '""')}"`;
}

export function buildFtsMatchQuery(terms: string[], operator: "AND" | "OR" = "AND"): string | null {
	return terms.length ? terms.map(escapeFtsToken).join(` ${operator} `) : null;
}

export function supportsTrigram(term: string): boolean {
	return (
		[
			...term.replace(
				/[\u0300-\u0304\u0306-\u030c\u030f\u0311\u031b\u0323-\u0328\u032d\u032e\u0330\u0331]/gu,
				"",
			),
		].length >= 3
	);
}
