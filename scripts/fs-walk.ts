import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function collectTsFiles(dir: string, acc: string[] = []): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const full = join(dir, String(entry.name));
		if (entry.isDirectory()) {
			await collectTsFiles(full, acc);
			continue;
		}
		const name = String(entry.name);
		if (name.endsWith(".ts") || name.endsWith(".tsx")) {
			acc.push(full);
		}
	}
	return acc;
}
