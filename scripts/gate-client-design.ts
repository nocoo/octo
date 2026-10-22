import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSync } from "oxc-parser";
import { runIfMain } from "./cli";

const containers = new Set([
	"div",
	"section",
	"article",
	"aside",
	"main",
	"nav",
	"header",
	"footer",
	"h2",
]);
const controls = new Set(["button", "input", "select", "textarea", "details", "summary"]);
const spacing = /^(?:padding|margin|gap|rowGap|columnGap)/;

function tokenSpacing(value: unknown): boolean {
	return (
		typeof value === "string" &&
		value
			.replace(/var\(--basalt-[\w-]+\)/g, "")
			.replace(/\b(?:auto|unset|inherit|initial|normal)\b/g, "")
			.trim() === ""
	);
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const child of value) walk(child, visit);
		return;
	}
	const node = value as Record<string, unknown>;
	visit(node);
	for (const child of Object.values(node)) walk(child, visit);
}

export function checkClientDesign(file: string, source: string): string[] {
	const errors: string[] = [];
	if (file.endsWith(".css")) {
		for (const match of source
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.matchAll(
				/(?:^|[;{])\s*((?:padding|margin)(?:-[\w-]+)?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/g,
			)) {
			if (!tokenSpacing(match[2])) errors.push(`${file}: ${match[1]} must use Basalt tokens`);
		}
		return errors;
	}
	const parsed = parseSync(file, source);
	for (const _error of parsed.errors) errors.push(`${file}: invalid source`);
	walk(parsed.program, (node) => {
		if (node.type !== "JSXOpeningElement") return;
		const name = (node.name as { name?: string }).name;
		const attributes = node.attributes as {
			name?: { name?: string };
			value?: {
				value?: unknown;
				expression?: {
					type?: string;
					properties?: {
						type: string;
						computed?: boolean;
						key: { name?: string; value?: string };
						value: { value?: unknown };
					}[];
				};
			};
		}[];
		const hiddenFile =
			name === "input" &&
			attributes.some(
				(attribute) => attribute.name?.name === "type" && attribute.value?.value === "file",
			) &&
			attributes.some((attribute) => attribute.name?.name === "hidden" && !attribute.value);
		if (name && (containers.has(name) || (controls.has(name) && !hiddenFile)))
			errors.push(`${file}: use a Basalt component instead of <${name}>`);
		for (const attribute of attributes) {
			if (attribute.name?.name === "className")
				walk(attribute.value, (part) => {
					const text =
						part.type === "TemplateElement" ? (part.value as { raw: string }).raw : part.value;
					if (
						typeof text === "string" &&
						/(?:^|[\s:])(?:[mp][trblxy]?|gap(?:-[xy])?|space-[xy])-(?:\d|\[|$)/.test(text)
					)
						errors.push(`${file}: raw spacing utility`);
				});
			if (attribute.name?.name !== "style") continue;
			if (attribute.value?.expression?.type !== "ObjectExpression") {
				errors.push(`${file}: style must be an explicit object for spacing inspection`);
				continue;
			}
			for (const property of attribute.value?.expression?.properties ?? []) {
				if (property.type === "SpreadElement" || property.computed) {
					errors.push(`${file}: style must not hide spacing in spreads or computed keys`);
					continue;
				}
				const key = property.key?.name ?? property.key?.value;
				if (key && spacing.test(key) && !tokenSpacing(property.value.value))
					errors.push(`${file}: ${key} must use Basalt tokens`);
			}
		}
	});
	return errors;
}

export async function runGateClientDesign(root = "apps/web/src/client"): Promise<number> {
	const files = (await readdir(root, { recursive: true })).filter(
		(file) => /\.(tsx?|css)$/.test(file) && !/\.test\.|(?:^|\/)__tests__\//.test(file),
	);
	const errors = files.length ? [] : ["client design scan must not be empty"];
	for (const file of files)
		errors.push(...checkClientDesign(file, await readFile(join(root, file), "utf8")));
	for (const error of errors) console.error(error);
	if (errors.length) return 1;
	console.log(`gate:client-design passed (${files.length} files)`);
	return 0;
}

export async function main(root?: string): Promise<number> {
	return runGateClientDesign(root);
}

await runIfMain(import.meta, main);
