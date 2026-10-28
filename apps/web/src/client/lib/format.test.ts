import { describe, expect, it } from "vitest";
import { formatBytes, formatNumber, formatPercent, formatTimestamp, localBucket } from "./format";

describe("record formatting", () => {
	it("groups comparable counts without losing zero or missing values", () => {
		expect(formatNumber(1234567)).toBe("1,234,567");
		expect(formatNumber(0)).toBe("0");
		expect(formatNumber(null)).toBe("—");
	});
	it("renders shares as percentages and keeps unknown values visible", () => {
		expect(formatPercent(0.6)).toBe("60%");
		expect(formatPercent(4 / 30, 1)).toBe("13.3%");
		expect(formatPercent(0)).toBe("0%");
		expect(formatPercent(null)).toBe("—");
	});
	it("labels binary byte sizes accurately and retains small values", () => {
		for (const [bytes, expected] of [
			[0, "0 B"],
			[31, "31 B"],
			[1024, "1 KiB"],
			[1536, "1.5 KiB"],
			[1048576, "1 MiB"],
			[1073741824, "1 GiB"],
		] as const)
			expect(formatBytes(bytes)).toBe(expected);
	});
	it("renders stored UTC instants in the runtime zone without a zone label", () => {
		expect(formatTimestamp("2026-09-30T05:42:19Z")).toBe("2026-09-30，05:42");
		expect(formatTimestamp(Date.parse("2026-09-30T05:42:19Z"))).toBe("2026-09-30，05:42");
		expect(formatTimestamp(null)).toBe("—");
		expect(formatTimestamp("invalid")).toBe("—");
	});
	it("follows the session time zone and keeps the full-width comma", () => {
		const original = process.env.TZ;
		try {
			for (const [zone, expected] of [
				["Asia/Shanghai", "2026-09-30，13:42"],
				["America/New_York", "2026-09-30，01:42"],
			] as const) {
				process.env.TZ = zone;
				expect(formatTimestamp("2026-09-30T05:42:19Z")).toBe(expected);
			}
		} finally {
			process.env.TZ = original;
		}
	});
	it("derives local month, day and hour buckets from the same instant", () => {
		const value = "2026-09-30T05:42:19Z";
		expect(localBucket(value, "month")).toBe("2026-09");
		expect(localBucket(value, "day")).toBe("2026-09-30");
		expect(localBucket(value, "hour")).toBe("2026-09-30 05:00");
		expect(localBucket("invalid", "day")).toBeNull();
		expect(localBucket(null, "day")).toBeNull();
	});
});
