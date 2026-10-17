import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function ensureDevVars(root: string): void {
	const dest = join(root, ".dev.vars");
	if (existsSync(dest)) {
		return;
	}
	const leftover = readdirSync(root).find(
		(name) => name.startsWith(".dev.vars.__") && name !== ".dev.vars",
	);
	if (leftover) {
		renameSync(join(root, leftover), dest);
		return;
	}
	const example = join(root, "dev.vars.example");
	if (!existsSync(example)) {
		throw new Error("dev.vars.example is required");
	}
	const body = readFileSync(example, "utf8");
	writeFileSync(dest, body.endsWith("\n") ? body : `${body}\n`);
}

export function ensureClientAssets(root: string, title = "octo"): string {
	const dir = join(root, "dist/client");
	const file = join(dir, "index.html");
	if (!existsSync(file)) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, `<!doctype html><title>${title}</title>\n`);
	}
	return file;
}
