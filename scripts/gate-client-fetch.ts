import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { parseSync } from "oxc-parser";
import { runIfMain } from "./cli";
import { collectTsFiles } from "./fs-walk";

function nodes(value: unknown, visit: (node: Record<string, unknown>) => void): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) nodes(item, visit);
		return;
	}
	const node = value as Record<string, unknown>;
	visit(node);
	for (const child of Object.values(node)) nodes(child, visit);
}

function inspect(file: string, source: string): { errors: string[]; calls: number } {
	const parsed = parseSync(file, source);
	const errors = parsed.errors.map(() => `${file}: invalid source`);
	let calls = 0;
	nodes(parsed.program, (node) => {
		const name = node.name ?? node.value;
		if (
			(node.type === "Identifier" || node.type === "Literal") &&
			["fetch", "XMLHttpRequest", "axios", "node-fetch", "WebSocket", "EventSource"].includes(
				String(name),
			)
		) {
			if (file !== "lib/api.ts" || name !== "fetch")
				errors.push(`${file}: transport is only allowed in lib/api.ts`);
		}
		if (node.type !== "CallExpression") return;
		const callee = node.callee as Record<string, unknown>;
		if (callee.type !== "Identifier" || callee.name !== "fetch") return;
		calls += 1;
		if (file !== "lib/api.ts") return;
		const first = (node.arguments as Record<string, unknown>[])[0];
		const quasis = first?.quasis as { value: { cooked: string } }[] | undefined;
		if (first?.type !== "TemplateLiteral" || quasis?.[0]?.value.cooked !== "/api/admin") {
			errors.push(`${file}: fetch must use the literal /api/admin prefix`);
		}
	});
	return { errors, calls };
}

export function checkClientSource(file: string, source: string): string[] {
	return inspect(file, source).errors;
}

export async function runGateClientFetch(root = "apps/web/src/client"): Promise<number> {
	const errors: string[] = [];
	let calls = 0;
	for (const file of await collectTsFiles(root)) {
		if (file.includes(".test.")) continue;
		const result = inspect(relative(root, file), await readFile(file, "utf8"));
		errors.push(...result.errors);
		calls += result.calls;
	}
	if (calls !== 1) errors.push("client must contain exactly one fetch call");
	if (errors.length) {
		for (const error of errors) console.error(error);
		return 1;
	}
	console.log("gate:client-fetch passed");
	return 0;
}

export async function main(root?: string): Promise<number> {
	return runGateClientFetch(root);
}

await runIfMain(import.meta, main);
