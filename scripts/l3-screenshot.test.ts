import type { Page } from "@playwright/test";
import { expect, it, vi } from "vitest";
import { screenshotOptions } from "./l3-screenshot";

it("masks the localized one-time and replacement secrets in every screenshot", () => {
	const getByLabel = vi.fn((label: string) => label);
	const options = screenshotOptions({ getByLabel } as unknown as Page, "evidence.png");
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
