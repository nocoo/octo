import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { runIfMain } from "./cli";
import { collectTsFiles } from "./fs-walk";

const remoteFlag = `${"--"}remote`;
const remoteTrue = /\bremote\s*=\s*true\b|\bremote\s*:\s*true\b/;

export function remoteViolation(text: string): boolean {
	return text.includes(remoteFlag) || remoteTrue.test(text);
}

export function valueHasRemoteTrue(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(valueHasRemoteTrue);
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (record.remote === true) {
			return true;
		}
		return Object.values(record).some(valueHasRemoteTrue);
	}
	return false;
}

export function tomlHasRemoteBinding(text: string): boolean {
	try {
		return valueHasRemoteTrue(parse(text));
	} catch {
		return true;
	}
}

export async function scanRemote(files: string[]): Promise<string[]> {
	const hits: string[] = [];
	for (const file of files) {
		const text = await readFile(file, "utf8");
		const forbidden = file.endsWith(".toml") ? tomlHasRemoteBinding(text) : remoteViolation(text);
		if (forbidden) {
			hits.push(file);
		}
	}
	return hits;
}

export async function runGateNoRemote(root = "."): Promise<number> {
	const files = [
		`${root}/wrangler.toml`,
		...(await collectTsFiles(`${root}/scripts`)),
		...(await collectTsFiles(`${root}/tests`)),
	];
	const hits = await scanRemote(files);
	if (hits.length > 0) {
		for (const hit of hits) {
			console.error(`${hit}: forbidden remote wrangler usage`);
		}
		return 1;
	}
	console.log("gate:no-remote passed");
	return 0;
}

export async function main(): Promise<number> {
	return runGateNoRemote();
}

await runIfMain(import.meta, main);
