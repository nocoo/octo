import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";

export const LOCAL_WRANGLER_CONFIG = ".wrangler.local.toml";

export function localWranglerConfig(toml: string): string {
	const config = parse(toml);
	delete config.vectorize;
	return stringify(config);
}

export function writeDevWranglerConfig(cwd: string): void {
	writeFileSync(
		join(cwd, LOCAL_WRANGLER_CONFIG),
		localWranglerConfig(readFileSync(join(cwd, "wrangler.toml"), "utf8")),
	);
}
