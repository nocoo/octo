import { once } from "node:events";
import { createConnection } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../../apps/web/src/server/attachments/content-type";
import { MAX_MULTIPART_OVERHEAD_BYTES } from "../../apps/web/src/server/attachments/upload";
import { e2eFetch } from "../../scripts/e2e-fetch";
import { cleanupAttachmentFixtures, setupAttachmentFixtures } from "../fixtures/attachments";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";

describe("attachment transport ownership", () => {
	afterAll(cleanupAttachmentFixtures);

	it.each([
		["raw", false, false, true],
		["multipart", false, false, true],
		["raw", true, false, true],
		["multipart", true, false, true],
		["raw", true, true, true],
		["multipart", true, true, true],
		["raw", false, false, false],
	] as const)(
		"terminates %s (keyed=%s declared=%s authorized=%s) with EOF gated",
		async (kind, keyed, declared, authorized) => {
			const { header } = await setupAttachmentFixtures();
			const probe = crypto.randomUUID();
			const tail = Promise.withResolvers<void>();
			const response = Promise.withResolvers<{ status: number; body: string }>();
			let tailReleased = false;
			let eofSent = false;
			let sent = 0;
			const target = new URL(base);
			const limit = MAX_ATTACHMENT_BYTES + (kind === "raw" ? 0 : MAX_MULTIPART_OVERHEAD_BYTES);
			const socket = createConnection({ host: target.hostname, port: Number(target.port) });
			const peerEnded = once(socket, "end");
			const closed = once(socket, "close");
			let received = "";
			socket.setEncoding("utf8");
			socket.on("error", response.reject);
			socket.on("data", (data) => {
				received += data;
				const boundary = received.indexOf("\r\n\r\n");
				if (boundary < 0) return;
				const headers = received.slice(0, boundary);
				const length = /content-length: (\d+)/i.exec(headers)?.[1];
				if (length === undefined) {
					response.reject(new Error(`missing response length: ${headers}`));
					return;
				}
				const body = received.slice(boundary + 4);
				if (Buffer.byteLength(body) >= Number(length)) {
					response.resolve({ status: Number(headers.split(" ")[1]), body });
				}
			});
			await once(socket, "connect");
			socket.write(
				[
					"POST /api/v1/memories/meme2e000001/attachments HTTP/1.1",
					`Host: ${target.host}`,
					...(authorized ? [`Authorization: ${header}`] : []),
					`Content-Type: ${kind === "raw" ? "image/png" : "multipart/form-data; boundary=x"}`,
					"X-Filename: gated.png",
					`X-Test-Upload-Probe: ${probe}`,
					...(keyed ? [`Idempotency-Key: m5-gated-${probe}`] : []),
					declared ? `Content-Length: ${limit + 1}` : "Transfer-Encoding: chunked",
					"Connection: close",
					"",
					"",
				].join("\r\n"),
			);
			const chunk = Buffer.alloc(1024 * 1024);
			const budget = declared || !authorized ? 0 : limit + 1;
			const sending = (async () => {
				while (sent < budget && !socket.destroyed) {
					const part = chunk.subarray(0, Math.min(chunk.length, budget - sent));
					socket.write(`${part.length.toString(16)}\r\n`);
					socket.write(part);
					sent += part.length;
					if (!socket.write("\r\n")) await Promise.race([once(socket, "drain"), closed]);
				}
				await tail.promise;
				if (!socket.destroyed && !socket.readableEnded) {
					eofSent = true;
					socket.end(declared ? "tail" : "4\r\ntail\r\n0\r\n\r\n");
				}
			})();
			const counts = async () => {
				const result = await e2eFetch(`${base}/api/__test/upload-reads`, {
					headers: { "X-Test-Upload-Probe": probe },
				});
				return result.json() as Promise<{
					bytes: number;
					reads: number;
					observerBytes: number;
					termination: string;
				}>;
			};
			try {
				const result = await response.promise;
				expect(result.status).toBe(authorized ? 413 : 401);
				expect(JSON.parse(result.body)).toMatchObject({
					error: {
						code: authorized ? "payload_too_large" : "unauthenticated",
						request_id: expect.any(String),
					},
				});
				expect(tailReleased).toBe(false);
				expect(eofSent).toBe(false);
				const atResponse = await counts();
				expect(atResponse.termination).toBe(
					"TypeError: Can't read from request stream after response has been sent.",
				);
				expect(atResponse.observerBytes).toBe(0);
				expect(atResponse.bytes).toBe(budget);
				expect(await counts()).toEqual(atResponse);
				expect(sent).toBeLessThanOrEqual(budget);
				expect(eofSent).toBe(false);
			} finally {
				tailReleased = true;
				tail.resolve();
				await sending;
				await peerEnded;
				await closed;
			}
		},
	);
});
