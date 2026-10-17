export const FTS_SHORT_SCAN_LIMIT = 500;

export type TokenizedQuery = {
	longTerms: string[];
	shortTerms: string[];
	allShort: boolean;
};

const SPLIT_RE = /[\s\p{P}\p{S}]+/u;

export function tokenizeQuery(query: string): TokenizedQuery {
	const raw = query.trim();
	if (!raw) {
		return { longTerms: [], shortTerms: [], allShort: false };
	}
	const parts = raw.split(SPLIT_RE).filter(Boolean);
	const longTerms: string[] = [];
	const shortTerms: string[] = [];
	for (const part of parts) {
		if ([...part].length >= 3) {
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
