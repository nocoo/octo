import { describe, expect, it } from "vitest";
import { formatBytes, formatDateTime, formatNumber, formatPercent } from "./format";

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
	it("formats explicit UTC and local timestamps without displaying invalid dates", () => {
		expect(formatDateTime("2026-10-20T04:05:06Z", "UTC")).toBe("2026/10/20 04:05:06");
		expect(formatDateTime("2026-10-20T04:05:06Z")).toMatch(/^2026\/10\/20 \d{2}:05:06$/);
		expect(formatDateTime(null)).toBe("—");
		expect(formatDateTime("invalid")).toBe("—");
	});
	it("formats the epoch milliseconds returned in history diffs, including zero", () => {
		expect(formatDateTime(1792469106000, "UTC")).toBe("2026/10/20 04:05:06");
		expect(formatDateTime(0, "UTC")).toBe("1970/01/01 00:00:00");
	});
});
