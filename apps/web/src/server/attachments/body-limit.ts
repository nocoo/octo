import { ApiError } from "../lib/errors";

export async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
	const lenHeader = request.headers.get("Content-Length");
	if (lenHeader) {
		const declared = Number.parseInt(lenHeader, 10);
		if (Number.isFinite(declared) && declared > maxBytes) {
			throw new ApiError("payload_too_large", "attachment too large");
		}
	}
	const body = request.body;
	if (!body) {
		return new Uint8Array(0);
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			total += value.byteLength;
			if (total > maxBytes) {
				throw new ApiError("payload_too_large", "attachment too large");
			}
			chunks.push(value);
		}
	} catch (err) {
		await reader.cancel().catch(() => {});
		throw err;
	} finally {
		reader.releaseLock();
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}
