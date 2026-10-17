export function highlightSnippet(body: string, terms: string[], maxLen = 240): string {
	const lowered = body.toLowerCase();
	let hit = -1;
	let hitLen = 0;
	for (const term of terms) {
		const idx = lowered.indexOf(term.toLowerCase());
		if (idx >= 0 && (hit < 0 || idx < hit)) {
			hit = idx;
			hitLen = term.length;
		}
	}
	if (hit < 0) {
		const slice = body.slice(0, maxLen);
		return slice.length < body.length ? `${slice}…` : slice;
	}
	const start = Math.max(0, hit - Math.floor((maxLen - hitLen) / 2));
	const chunk = body.slice(start, start + maxLen);
	const rel = hit - start;
	const before = chunk.slice(0, rel);
	const mid = chunk.slice(rel, rel + hitLen);
	const after = chunk.slice(rel + hitLen);
	const suffix = start + chunk.length < body.length ? "…" : "";
	return `${before}<mark>${mid}</mark>${after}${suffix}`;
}
