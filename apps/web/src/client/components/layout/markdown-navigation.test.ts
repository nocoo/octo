import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isCurrentMarkdownFragment,
	isPlainLinkClick,
	navigateToMarkdownHeading,
	restoreMarkdownHeading,
} from "./markdown-navigation";

afterEach(() => vi.unstubAllGlobals());

describe("markdown navigation helpers", () => {
	it("recognizes equivalent encoded fragments and ignores malformed hashes", () => {
		vi.stubGlobal("window", { location: { hash: "#heading-%E4%B8%AD%E6%96%87" } });
		expect(isCurrentMarkdownFragment("#heading-中文")).toBe(true);
		expect(isCurrentMarkdownFragment("#heading-%E4%B8%AD%E6%96%87")).toBe(true);
		expect(isCurrentMarkdownFragment("#heading-other")).toBe(false);
		expect(isCurrentMarkdownFragment("#%invalid")).toBe(false);
	});

	it("ignores modified, secondary and prevented link clicks", () => {
		const event = {
			defaultPrevented: false,
			button: 0,
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
		};
		expect(isPlainLinkClick(event)).toBe(true);
		for (const modifier of ["defaultPrevented", "metaKey", "ctrlKey", "shiftKey", "altKey"]) {
			expect(isPlainLinkClick({ ...event, [modifier]: true })).toBe(false);
		}
		expect(isPlainLinkClick({ ...event, button: 1 })).toBe(false);
	});

	it("focuses and scrolls without mutating router-owned history", () => {
		const heading = { focus: vi.fn(), scrollIntoView: vi.fn() };
		const getElementById = vi.fn().mockReturnValue(heading);
		const location = { hash: "#previous" };
		vi.stubGlobal("document", { getElementById });
		vi.stubGlobal("window", { location });
		expect(navigateToMarkdownHeading("heading-follow-up")).toBe(true);
		expect(location.hash).toBe("#previous");
		expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
		getElementById.mockReturnValue(null);
		expect(navigateToMarkdownHeading("heading-missing")).toBe(false);
	});

	it("restores encoded fragments and ignores absent or malformed hashes", () => {
		const heading = { focus: vi.fn(), scrollIntoView: vi.fn() };
		const getElementById = vi.fn().mockReturnValue(heading);
		vi.stubGlobal("document", { getElementById });
		expect(restoreMarkdownHeading("#heading-%E4%B8%AD%E6%96%87")).toBe(true);
		expect(getElementById).toHaveBeenCalledWith("heading-中文");
		expect(restoreMarkdownHeading("")).toBe(false);
		expect(restoreMarkdownHeading("#%invalid")).toBe(false);
		getElementById.mockReturnValue(null);
		expect(restoreMarkdownHeading("#missing")).toBe(false);
	});
});
