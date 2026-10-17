import { APP_VERSION } from "../../lib/version";
import type { Env } from "../env";
import { probeD1, readTestMarker } from "../lib/d1";
import { jsonOk } from "../lib/errors";

export async function liveResponse(env: Env): Promise<Response> {
	const connected = await probeD1(env.DB);
	const marker = connected ? await readTestMarker(env.DB) : null;
	return jsonOk(
		{
			status: connected ? "ok" : "error",
			name: "octo",
			version: APP_VERSION,
			database: { connected },
			d1_marker: marker,
		},
		connected ? 200 : 503,
		{ "cache-control": "no-store" },
	);
}
