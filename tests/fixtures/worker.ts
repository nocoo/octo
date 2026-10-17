import type { Env } from "../../apps/web/src/server/env";
import { worker } from "../../apps/web/src/server/index";
import { MEMORY_FIXTURE_SQL } from "./memories";

const initialized = new WeakSet<D1Database>();
const uploadReads = new Map<
	string,
	{
		bytes: number;
		reads: number;
		observerBytes: number;
		termination: string | null;
	}
>();
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		if (
			env.RESOURCE_ENV !== "test" ||
			(
				await env.DB.prepare("SELECT value FROM _test_marker WHERE key = 'env'").first<{
					value: string;
				}>()
			)?.value !== "test"
		)
			throw new Error("refusing fixture without local test marker");
		if (!initialized.has(env.DB)) {
			await env.DB.exec(MEMORY_FIXTURE_SQL);
			initialized.add(env.DB);
		}
		const probe = request.headers.get("X-Test-Upload-Probe");
		if (probe && new URL(request.url).pathname === "/api/__test/upload-reads") {
			const counts = uploadReads.get(probe);
			if (!counts) return Response.json(null);
			return Response.json(counts);
		}
		let observe: (() => Promise<void>) | undefined;
		if (probe && request.body) {
			const getReader = request.body.getReader.bind(request.body);
			const counts = { bytes: 0, reads: 0, observerBytes: 0, termination: null as string | null };
			uploadReads.set(probe, counts);
			observe = async () => {
				const reader = getReader();
				try {
					const result = await reader.read();
					counts.observerBytes = result.value?.byteLength ?? 0;
					counts.termination = result.done ? "EOF" : "still readable";
				} catch (error) {
					counts.termination = String(error);
				} finally {
					reader.releaseLock();
				}
			};
			Object.defineProperty(request.body, "getReader", {
				value: () => {
					const reader = getReader();
					const read = reader.read.bind(reader);
					reader.read = async () => {
						const result = await read();
						counts.reads++;
						counts.bytes += result.value?.byteLength ?? 0;
						return result;
					};
					return reader;
				},
			});
		}
		const response = await worker.fetch(request, env, ctx);
		if (observe) ctx.waitUntil(observe());
		return response;
	},
	scheduled: worker.scheduled,
};
