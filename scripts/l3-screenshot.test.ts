import type { Page } from "@playwright/test";
import { expect, it, vi } from "vitest";
import { screenshotOptions } from "./l3-screenshot";

it("masks the localized one-time and replacement secrets in every screenshot", () => {
	const getByLabel = vi.fn((label: string) => ({ and: () => label }));
	const locator = vi.fn();
	const options = screenshotOptions({ getByLabel, locator } as unknown as Page, "evidence.png");
	expect(options).toEqual({
		path: "evidence.png",
		fullPage: true,
		animations: "disabled",
		mask: ["接口密钥", "替换密钥"],
	});
	expect(getByLabel.mock.calls).toEqual([
		["接口密钥", { exact: true }],
		["替换密钥", { exact: true }],
	]);
});

it("does not mask page headings or tables that share a secret field label", () => {
	const input = {};
	const intersection = vi.fn((label: string) => `input:${label}`);
	const getByLabel = vi.fn((label: string) => ({ and: () => intersection(label) }));
	const locator = vi.fn(() => input);
	const options = screenshotOptions({ getByLabel, locator } as unknown as Page, "page.png");
	expect(options.mask).toEqual(["input:接口密钥", "input:替换密钥"]);
	expect(locator).toHaveBeenCalledWith("input");
});
