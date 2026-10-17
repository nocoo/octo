import type { Page } from "@playwright/test";

export function screenshotOptions(page: Page, path: string) {
	return {
		path,
		fullPage: true,
		animations: "disabled" as const,
		mask: [
			page.getByLabel("接口密钥", { exact: true }),
			page.getByLabel("替换密钥", { exact: true }),
		],
	};
}
