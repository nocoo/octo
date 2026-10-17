import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse, Page, TestInfo } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { accessHeaders, assertL3Isolation } from "./setup";

export interface TestMemory {
	id: string;
	title: string;
	body: string;
	version: number;
	space: string;
}

class AdminFixture {
	constructor(private readonly request: APIRequestContext) {}
	async response(
		path: string,
		method = "GET",
		data?: unknown,
		headers?: Record<string, string>,
	): Promise<APIResponse> {
		if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
			throw new Error("Invalid fixture API path");
		if (method !== "GET") await assertL3Isolation();
		return this.request.fetch(`/api/admin${path}`, {
			method,
			maxRedirects: 0,
			...(data === undefined ? {} : { data }),
			...(headers ? { headers } : {}),
		});
	}
	async json<Result>(
		path: string,
		method = "GET",
		data?: unknown,
		headers?: Record<string, string>,
	): Promise<Result> {
		const response = await this.response(path, method, data, headers);
		expect(
			response.ok(),
			`${method} /api/admin${path}: HTTP ${response.status()} (real admin API required)`,
		).toBe(true);
		return response.json() as Promise<Result>;
	}
	async memory(
		body = "# Field notes\n\nOriginal field notes.\n\n## Details\n\n| Signal | Value |\n| --- | --- |\n| local | true |\n\n```ts\nconst octo = true;\n```\n",
	): Promise<TestMemory> {
		const suffix = randomUUID().replaceAll("-", "");
		const space = `l3-${suffix}`;
		await this.json("/spaces", "POST", {
			slug: space,
			name: `L3 ${suffix}`,
			description: "Isolated browser fixtures",
		});
		return this.json<TestMemory>("/memories", "POST", {
			space,
			title: `Field notes ${suffix}`,
			body,
			type: "note",
			tags: ["l3", "field-notes"],
			importance: 0.6,
		});
	}
}

export async function capture(page: Page, info: TestInfo, name: string): Promise<string> {
	const path = info.outputPath(`${name}.png`);
	await page.screenshot({
		path,
		fullPage: true,
		animations: "disabled",
		mask: [
			page.getByLabel("API key", { exact: true }),
			page.getByLabel("Replacement API key", { exact: true }),
		],
	});
	await info.attach(name, { path, contentType: "image/png" });
	console.log(`L3 screenshot: ${path}`);
	return path;
}

export const test = base.extend<{ admin: AdminFixture }>({
	extraHTTPHeaders: async ({ baseURL }, use) => {
		if (baseURL !== "http://127.0.0.1:27059") throw new Error("L3 requires the local Worker");
		await use(await accessHeaders());
	},
	admin: async ({ request }, use) => {
		await assertL3Isolation();
		const admin = new AdminFixture(request);
		const identity = await admin.json<{ email: string }>("/whoami");
		expect(identity.email).toBe("l3@local");
		await use(admin);
	},
	context: async ({ context }, use) => {
		await context.route("**/*", async (route) => {
			const url = new URL(route.request().url());
			if (url.origin === "http://127.0.0.1:27059" || ["data:", "blob:"].includes(url.protocol))
				await route.continue();
			else {
				await route.abort("blockedbyclient");
				throw new Error(`L3 forbids external browser requests: ${url.origin}`);
			}
		});
		await use(context);
	},
});

test.afterEach(async ({ page }, info) => {
	if (info.status !== info.expectedStatus) await capture(page, info, "failure");
});

export { expect };
