const numbers = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function formatNumber(value: number | null): string {
	return value === null ? "—" : numbers.format(value);
}

export function formatBytes(bytes: number): string {
	const unit = bytes === 0 ? 0 : Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${formatNumber(bytes / 1024 ** unit)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

export function formatDateTime(value: string | null, timeZone?: string): string {
	if (!value || !Number.isFinite(Date.parse(value))) return "—";
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
		...(timeZone ? { timeZone } : {}),
	}).format(new Date(value));
}
