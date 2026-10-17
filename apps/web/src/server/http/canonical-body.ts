const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function canonicalBody(raw: string): string {
	if (raw.length === 0) {
		return "";
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		return JSON.stringify(sortJson(parsed));
	} catch {
		return raw;
	}
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sortJson(item));
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([key]) => !UNSAFE_KEYS.has(key))
			.sort(([a], [b]) => a.localeCompare(b));
		const out: Record<string, unknown> = {};
		for (const [key, child] of entries) {
			out[key] = sortJson(child);
		}
		return out;
	}
	return value;
}
