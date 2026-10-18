export const FTS_SHORT_SCAN_LIMIT = 500;

export type TokenizedQuery = {
	longTerms: string[];
	shortTerms: string[];
	allShort: boolean;
};

const SPLIT_RE = /[\s\p{P}\p{S}]+/u;
const ENGLISH_STOPWORDS = new Set(
	`a an and are as at be been being but by can could did do does doing for from
had has have having he her hers herself him himself his how i if in into is it its itself
me my myself of on or our ours ourselves she should so than that the their theirs them
themselves then there these they this those to us was we were what when where which
who whom whose why will with would you your yours yourself yourselves`.split(/\s+/),
);
const CHINESE_QUESTION_WORDS = new Set(
	"什么 多久 怎么 怎样 如何 为什么 为何 哪里 哪个 哪些 请问".split(" "),
);
const CHINESE_PRONOUNS = new Set("他 她 它 你 您 我 我们 你们 他们 她们 它们".split(" "));
const CHINESE_STOPWORDS = new Set([
	...CHINESE_QUESTION_WORDS,
	...CHINESE_PRONOUNS,
	..."哪 吗 呢 吧 啊 的 了 着 是 有 没有 在 和 与 或 一下".split(" "),
]);
const CHINESE_SEGMENTER = new Intl.Segmenter("zh", { granularity: "word" });
// SQLite FTS5 remove_diacritics=1 removes this subset, not all Unicode marks.
const FTS_DIACRITICS_RE =
	/[\u0300-\u0304\u0306-\u030c\u030f\u0311\u031b\u0323-\u0328\u032d\u032e\u0330\u0331]/gu;

function splitChineseQuestion(part: string): string[] {
	if (!/^\p{Script=Han}+$/u.test(part)) return [part];
	const words = [...CHINESE_SEGMENTER.segment(part)];
	const removable = words.filter(
		({ segment, index }) =>
			CHINESE_QUESTION_WORDS.has(segment) || /^[吗呢吧啊]+$/u.test(part.slice(index)),
	);
	if (!removable.length) return [part];
	const first = words[0];
	if (first && CHINESE_PRONOUNS.has(first.segment)) removable.unshift(first);
	const terms: string[] = [];
	let start = 0;
	for (const { segment, index } of removable) {
		terms.push(part.slice(start, index));
		start = index + segment.length;
	}
	terms.push(part.slice(start));
	return terms.filter(Boolean);
}

export function tokenizeQuery(query: string): TokenizedQuery {
	const raw = query.trim();
	if (!raw) {
		return { longTerms: [], shortTerms: [], allShort: false };
	}
	const parts = raw.split(SPLIT_RE).filter(Boolean);
	const meaningful = parts
		.flatMap(splitChineseQuestion)
		.filter((part) => !ENGLISH_STOPWORDS.has(part.toLowerCase()) && !CHINESE_STOPWORDS.has(part));
	const longTerms: string[] = [];
	const shortTerms: string[] = [];
	for (const part of meaningful.length ? meaningful : parts) {
		if ([...part.replace(FTS_DIACRITICS_RE, "")].length >= 3) {
			longTerms.push(part);
		} else if (part.length > 0) {
			shortTerms.push(part);
		}
	}
	return {
		longTerms,
		shortTerms,
		allShort: longTerms.length === 0 && shortTerms.length > 0,
	};
}

export function escapeFtsToken(token: string): string {
	return `"${token.replaceAll('"', '""')}"`;
}

export function buildFtsMatchQuery(longTerms: string[]): string | null {
	if (longTerms.length === 0) {
		return null;
	}
	return longTerms.map(escapeFtsToken).join(" OR ");
}
