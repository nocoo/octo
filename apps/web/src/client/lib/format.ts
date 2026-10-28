const numbers = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function formatNumber(value: number | null): string {
	return value === null ? "—" : numbers.format(value);
}

export function formatBytes(bytes: number): string {
	const unit = bytes === 0 ? 0 : Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${formatNumber(bytes / 1024 ** unit)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

export function formatPercent(value: number | null, digits = 0): string {
	if (value === null) return "—";
	return new Intl.NumberFormat("zh-CN", {
		style: "percent",
		maximumFractionDigits: digits,
	}).format(value);
}

export type TimeGrain = "month" | "day" | "hour";

let timestampCache: { zone: string; format: Intl.DateTimeFormat } | undefined;

function timestampFormat(): Intl.DateTimeFormat {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (timestampCache?.zone !== zone) {
		timestampCache = {
			zone,
			format: new Intl.DateTimeFormat("en-US", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			}),
		};
	}
	return timestampCache.format;
}

function timestampParts(value: string | number | null): Record<string, string> | null {
	if (value === null) return null;
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return null;
	const parts: Record<string, string> = {};
	for (const part of timestampFormat().formatToParts(date)) {
		if (part.type !== "literal") parts[part.type] = part.value;
	}
	return parts;
}

/** Stored UTC instants render in the browser's zone as `2026-09-30，13:42`. */
export function formatTimestamp(value: string | number | null): string {
	const parts = timestampParts(value);
	if (!parts) return "—";
	return `${parts.year}-${parts.month}-${parts.day}，${parts.hour}:${parts.minute}`;
}

export function localBucket(value: string | number | null, grain: TimeGrain): string | null {
	const parts = timestampParts(value);
	if (!parts) return null;
	const day = `${parts.year}-${parts.month}-${parts.day}`;
	if (grain === "month") return `${parts.year}-${parts.month}`;
	if (grain === "hour") return `${day} ${parts.hour}:00`;
	return day;
}
