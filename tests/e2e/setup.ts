import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { assertWranglerConfigLocal, root } from "../../scripts/e2e";
import { L2_ACCESS_AUD, l2AccessIss, loadJwksState, signAccessJwt } from "../../scripts/jwks-stub";
import { assertAsyncTestMarker, wranglerD1Args } from "../../scripts/local-d1";
import { bddPaths } from "../../scripts/run-e2e-bdd";

const execFileAsync = promisify(execFile);

export async function accessHeaders(): Promise<Record<string, string>> {
	const jwt = await signAccessJwt(await loadJwksState(), {
		iss: l2AccessIss(Number(process.env.OCTO_JWKS_PORT)),
		aud: L2_ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "l3@local",
	});
	return { "Cf-Access-Jwt-Assertion": jwt, Origin: "http://127.0.0.1:27059" };
}

export async function assertL3Isolation(): Promise<void> {
	const persist = process.env.OCTO_PERSIST;
	const config = process.env.OCTO_CONFIG;
	if (process.env.OCTO_E2E !== "http://127.0.0.1:27059" || !persist || !config) {
		throw new Error("L3 requires the isolated local runner");
	}
	const paths = bddPaths(basename(persist));
	if (
		persist !== paths.persist ||
		config !== join(paths.run, "wrangler.toml") ||
		process.env.OCTO_L3_ARTIFACTS !== paths.artifacts
	) {
		throw new Error("L3 requires matching per-run persistence, config and artifact paths");
	}
	if ((await realpath(persist)) !== persist || (await lstat(persist)).isSymbolicLink()) {
		throw new Error("L3 persistence must not be linked to another store");
	}
	assertWranglerConfigLocal(await readFile(config, "utf8"));
	await assertAsyncTestMarker(async (args) => {
		const { stdout } = await execFileAsync(
			join(root, "node_modules/.bin/wrangler"),
			wranglerD1Args(args, persist, config),
			{ cwd: root, encoding: "utf8" },
		);
		return stdout;
	});
}

export default async function setup(): Promise<void> {
	await assertL3Isolation();
	const response = await fetch("http://127.0.0.1:27059/api/admin/memories?limit=1", {
		headers: await accessHeaders(),
		redirect: "error",
	});
	if (!response.ok)
		throw new Error(
			`L3 blocked: real admin memory API returned HTTP ${response.status}; integrate M7 before running critical journeys`,
		);
}
