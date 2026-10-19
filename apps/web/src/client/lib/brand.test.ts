import { TAG_COLORS, tagColorFor } from "@nocoo/basalt/components/tag-badge";
import { accentForeground } from "@nocoo/basalt/providers/accent";
import { describe, expect, it } from "vitest";
import { logoAccent } from "./brand";

describe("logo accent and stable label palette", () => {
	it("uses the logo blue hue with readable foregrounds in both themes", () => {
		expect(logoAccent.sky).toEqual({ light: "210 72% 56%", dark: "210 72% 68%" });
		for (const channels of Object.values(logoAccent.sky)) {
			expect(accentForeground(channels)).toBe("0 0% 10%");
		}
	});
	it("retains a label color across repeats and reordered collections", () => {
		const labels = ["知识管理", "设计", "研究", "全部空间", "只读", "", "Octo 🐙"];
		const colors = new Map(labels.map((label) => [label, tagColorFor(label)]));
		for (const label of [...labels].reverse()) {
			expect(tagColorFor(label)).toBe(colors.get(label));
			expect(TAG_COLORS[tagColorFor(label)].className).toContain("basalt-tag-");
		}
	});
	it("spreads labels across all six fixed nonsemantic token colors", () => {
		const colors = Array.from({ length: 600 }, (_, index) => tagColorFor(`label-${index}`));
		expect([...new Set(colors)].sort()).toEqual([
			"amber",
			"blue",
			"rose",
			"slate",
			"teal",
			"violet",
		]);
		for (const color of new Set(colors)) {
			expect(colors.filter((candidate) => candidate === color).length).toBeGreaterThan(60);
		}
	});
});
