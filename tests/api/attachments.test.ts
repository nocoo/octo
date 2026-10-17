import { afterAll, describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../../apps/web/src/server/attachments/content-type";
import { MAX_MULTIPART_OVERHEAD_BYTES } from "../../apps/web/src/server/attachments/upload";
import { signAttachmentUrl } from "../../apps/web/src/server/attachments/url-sign";
import { seedAttachmentKey } from "../../scripts/attachment-fixtures";
import { e2eFetch as fetch } from "../../scripts/e2e-fetch";
import {
	cleanupAttachmentFixtures,
	setupAttachmentFixtures as setup,
} from "../fixtures/attachments";
import { query, sqlText } from "../fixtures/l2-batch";

const base = process.env.OCTO_E2E ?? "http://127.0.0.1:17059";
const urlSecret = "change-me-attachment-url-secret";
const memoryPath = "/api/v1/memories/meme2e000001/attachments";
const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

type CreatedAttachment = {
	id: string;
	markdown: string;
	sha256: string;
	size_bytes: number;
	created_at: string;
};

function endpoints(id: string) {
	return [
		["POST", memoryPath],
		["GET", memoryPath],
		["GET", `/api/v1/attachments/${id}/url`],
		["DELETE", `/api/v1/attachments/${id}`],
	] as const;
}

async function expectError(response: Response, status: number, code: string) {
	expect(response.status).toBe(status);
	expect(await response.json()).toMatchObject({ error: { code } });
}

async function rawUpload(header: string, body = png, contentType = "image/png", idemKey?: string) {
	return fetch(`${base}${memoryPath}`, {
		method: "POST",
		headers: {
			Authorization: header,
			"Content-Type": contentType,
			"X-Filename": "file.png",
			...(idemKey === undefined ? {} : { "Idempotency-Key": idemKey }),
		},
		body,
	});
}

async function createAttachment(header: string): Promise<CreatedAttachment> {
	const response = await rawUpload(header);
	expect(response.status).toBe(201);
	return response.json() as Promise<CreatedAttachment>;
}

async function signedUrl(header: string, id: string) {
	const response = await fetch(`${base}/api/v1/attachments/${id}/url`, {
		headers: { Authorization: header },
	});
	expect(response.status).toBe(200);
	const signed = (await response.json()) as { url: string; expires_at: string };
	expect(signed.expires_at).toMatch(isoUtc);
	const url = new URL(signed.url);
	expect(url.origin).toBe(new URL(base).origin);
	return url;
}

async function multipartUpload(header: string, form: FormData) {
	return fetch(`${base}${memoryPath}`, {
		method: "POST",
		headers: { Authorization: header },
		body: form,
	});
}

describe("attachments API", { sequential: true }, () => {
	afterAll(cleanupAttachmentFixtures);

	it("uploads, lists, signs, streams, and soft-deletes", async () => {
		const { header } = await setup();
		const created = await createAttachment(header);
		expect(created.created_at).toMatch(isoUtc);
		expect(created.markdown).toBe(`![](octo://att/${created.id})`);
		expect(created.size_bytes).toBe(png.length);
		const list = await fetch(`${base}${memoryPath}`, { headers: { Authorization: header } });
		expect(list.status).toBe(200);
		expect(await list.json()).toMatchObject({
			items: [{ id: created.id, created_at: created.created_at }],
		});

		const signed = await signedUrl(header, created.id);
		expect(signed.pathname).toBe(`/files/att/meme2e000001/${created.id}`);
		const file = await fetch(signed);
		expect(file.status).toBe(200);
		expect(file.headers.get("etag")).toBe(`"${created.sha256}"`);
		expect(file.headers.get("content-type")).toBe("image/png");
		expect(file.headers.get("content-disposition")).toContain("inline");
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(png);

		const del = await fetch(`${base}/api/v1/attachments/${created.id}`, {
			method: "DELETE",
			headers: { Authorization: header },
		});
		expect(del.status).toBe(200);
		expect(await del.json()).toEqual({ ok: true });
		const after = await fetch(`${base}${memoryPath}`, { headers: { Authorization: header } });
		expect(after.status).toBe(200);
		expect(await after.json()).toEqual({ items: [] });
		for (const [method, path] of endpoints(created.id).slice(2)) {
			await expectError(
				await fetch(`${base}${path}`, {
					method,
					headers: { Authorization: header },
				}),
				404,
				"not_found",
			);
		}
	});

	it("requires valid bearer auth for every metadata endpoint", async () => {
		const { header } = await setup();
		const { id } = await createAttachment(header);
		for (const auth of [undefined, "Bearer invalid"]) {
			for (const [method, path] of endpoints(id)) {
				await expectError(
					await fetch(`${base}${path}`, {
						method,
						headers: auth ? { Authorization: auth } : {},
					}),
					401,
					"unauthenticated",
				);
			}
		}
	});

	it("hides every metadata endpoint outside key scope", async () => {
		const { d1, header } = await setup();
		const { id } = await createAttachment(header);
		const scoped = await seedAttachmentKey(d1, { scope: "spaces" });
		for (const [method, path] of endpoints(id)) {
			await expectError(
				await fetch(`${base}${path}`, {
					method,
					headers: { Authorization: scoped.header },
				}),
				404,
				"not_found",
			);
		}
	});

	it("enforces operation permissions for every metadata endpoint", async () => {
		const { d1, header } = await setup();
		const { id } = await createAttachment(header);
		const denied = await seedAttachmentKey(d1, { ops: "w" });
		for (const [method, path] of endpoints(id)) {
			await expectError(
				await fetch(`${base}${path}`, {
					method,
					headers: { Authorization: denied.header },
				}),
				403,
				"forbidden",
			);
		}
	});

	it("forbids own-only mutations but allows reads of other entries", async () => {
		const { d1, header } = await setup();
		const { id } = await createAttachment(header);
		const own = await seedAttachmentKey(d1, { ownOnly: true });
		for (const [method, path] of endpoints(id)) {
			const response = await fetch(`${base}${path}`, {
				method,
				headers: { Authorization: own.header },
			});
			if (method === "GET") {
				expect(response.status).toBe(200);
				await response.arrayBuffer();
			} else {
				await expectError(response, 403, "forbidden");
			}
		}
	});

	it("returns 404 for missing memories and attachments", async () => {
		const { header } = await setup();
		for (const [method, path] of endpoints("missing")) {
			await expectError(
				await fetch(`${base}${path.replace("meme2e000001", "missing")}`, {
					method,
					headers: { Authorization: header },
				}),
				404,
				"not_found",
			);
		}
	});

	it("hides attachments of trashed memories", async () => {
		const { d1, header } = await setup();
		const { id } = await createAttachment(header);
		await d1(["--command", "UPDATE memories SET deleted_at = 1 WHERE id = 'meme2e000001'"]);
		for (const [method, path] of endpoints(id)) {
			await expectError(
				await fetch(`${base}${path}`, {
					method,
					headers: { Authorization: header },
				}),
				404,
				"not_found",
			);
		}
	});

	it("rejects unsigned, unexpired tampered, and expired file urls", async () => {
		const { header } = await setup();
		const { id } = await createAttachment(header);
		const signed = await signedUrl(header, id);
		await expectError(await fetch(`${base}${signed.pathname}`), 401, "unauthenticated");
		const sig = signed.searchParams.get("sig");
		expect(sig).toMatch(/^[0-9a-f]{64}$/);
		signed.searchParams.set("sig", `${sig?.[0] === "0" ? "1" : "0"}${sig?.slice(1)}`);
		await expectError(await fetch(signed), 401, "unauthenticated");
		const exp = Math.floor(Date.now() / 1000) - 10;
		const expiredSig = await signAttachmentUrl(urlSecret, `att/meme2e000001/${id}`, exp);
		await expectError(
			await fetch(`${base}${signed.pathname}?exp=${exp}&sig=${expiredSig}`),
			401,
			"unauthenticated",
		);
	});

	it("returns 404 for a valid signature on a missing blob", async () => {
		const exp = Math.floor(Date.now() / 1000) + 300;
		const key = "att/meme2e000001/missing";
		const sig = await signAttachmentUrl(urlSecret, key, exp);
		await expectError(await fetch(`${base}/files/${key}?exp=${exp}&sig=${sig}`), 404, "not_found");
	});

	it("forces svg attachment disposition", async () => {
		const { header } = await setup();
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
		const upload = await rawUpload(header, svg, "image/svg+xml");
		expect(upload.status).toBe(201);
		const { id } = (await upload.json()) as CreatedAttachment;
		const file = await fetch(await signedUrl(header, id));
		expect(file.status).toBe(200);
		expect(file.headers.get("content-disposition")).toContain("attachment");
		expect(await file.text()).toBe(new TextDecoder().decode(svg));
	});

	it("rejects unsupported raw types and missing filenames", async () => {
		const { header } = await setup();
		await expectError(await rawUpload(header, png, "text/plain"), 415, "unsupported_media_type");
		await expectError(
			await fetch(`${base}${memoryPath}`, {
				method: "POST",
				headers: { Authorization: header, "Content-Type": "image/png" },
				body: png,
			}),
			400,
			"validation_failed",
		);
	});

	it("accepts raw files at 50 mib and rejects one byte more", async () => {
		const { header } = await setup();
		const exact = await rawUpload(header, new Uint8Array(MAX_ATTACHMENT_BYTES));
		expect(exact.status).toBe(201);
		expect(await exact.json()).toMatchObject({ size_bytes: MAX_ATTACHMENT_BYTES });
		await expectError(
			await rawUpload(header, new Uint8Array(MAX_ATTACHMENT_BYTES + 1)),
			413,
			"payload_too_large",
		);
	});

	it.each(["raw", "multipart"])("rejects chunked oversize %s requests", async (kind) => {
		const { header } = await setup();
		const type = kind === "raw" ? "image/png" : "multipart/form-data; boundary=x";
		let sent = 0;
		const chunk = new Uint8Array(1024 * 1024);
		const response = await fetch(`${base}${memoryPath}`, {
			method: "POST",
			headers: { Authorization: header, "Content-Type": type, "X-Filename": "big.png" },
			body: new ReadableStream({
				pull(controller) {
					if (sent > MAX_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
						controller.close();
						return;
					}
					controller.enqueue(chunk);
					sent += chunk.byteLength;
				},
			}),
			duplex: "half",
		} as RequestInit);
		await expectError(response, 413, "payload_too_large");
	});

	it("accepts a 50 mib multipart file without counting its envelope", async () => {
		const { header } = await setup();
		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array(MAX_ATTACHMENT_BYTES)], "max.pdf", {
				type: "application/pdf",
			}),
		);
		const response = await multipartUpload(header, form);
		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			size_bytes: MAX_ATTACHMENT_BYTES,
			filename: "max.pdf",
			content_type: "application/pdf",
		});
	});

	it("rejects multipart file bytes over 50 mib", async () => {
		const { header } = await setup();
		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "big.pdf", {
				type: "application/pdf",
			}),
		);
		await expectError(await multipartUpload(header, form), 413, "payload_too_large");
	});

	it("rejects multipart extra parts, missing files, and malformed bodies", async () => {
		const { header } = await setup();
		for (const extra of ["note", "file"]) {
			const form = new FormData();
			form.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
			form.append(extra, "unexpected");
			await expectError(await multipartUpload(header, form), 400, "validation_failed");
		}
		await expectError(await multipartUpload(header, new FormData()), 400, "validation_failed");
		await expectError(
			await fetch(`${base}${memoryPath}`, {
				method: "POST",
				headers: { Authorization: header, "Content-Type": "multipart/form-data; boundary=x" },
				body: "broken",
			}),
			400,
			"validation_failed",
		);
		const badType = new FormData();
		badType.append("file", new File(["x"], "a.txt", { type: "text/plain" }));
		await expectError(await multipartUpload(header, badType), 415, "unsupported_media_type");
	});

	it("replays attachment upload and delete without duplicate effects", async () => {
		const { d1, header, keyId } = await setup();
		const upload = await rawUpload(header, png, "image/png", "m5-upload");
		expect(upload.status).toBe(201);
		const saved = await upload.text();
		const { id } = JSON.parse(saved) as CreatedAttachment;
		const replay = await rawUpload(header, png, "image/png", "m5-upload");
		expect(replay.status).toBe(201);
		expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
		expect(await replay.text()).toBe(saved);
		for (let i = 0; i < 2; i++) {
			const response = await fetch(`${base}/api/v1/attachments/${id}`, {
				method: "DELETE",
				headers: { Authorization: header, "Idempotency-Key": "m5-delete" },
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ ok: true });
			expect(response.headers.get("Idempotent-Replayed")).toBe(i === 0 ? null : "true");
		}
		expect(
			await query(
				d1,
				`SELECT op, COUNT(*) AS n FROM changes WHERE entity = 'attachment' AND entity_id = ${sqlText(id)} GROUP BY op ORDER BY op`,
			),
		).toEqual([
			{ op: "created", n: 1 },
			{ op: "trashed", n: 1 },
		]);
		expect(
			await query(
				d1,
				`SELECT COUNT(*) AS n FROM idempotency_records WHERE key_id = ${sqlText(keyId)}`,
			),
		).toEqual([{ n: 2 }]);
	});

	it("rejects binary replay conflicts and keyed declared oversize", async () => {
		const { header } = await setup();
		const first = await rawUpload(header, new Uint8Array([255]), "image/png", "m5-binary");
		expect(first.status).toBe(201);
		await first.arrayBuffer();
		await expectError(
			await rawUpload(header, new Uint8Array([254]), "image/png", "m5-binary"),
			409,
			"idempotency_conflict",
		);
		await expectError(
			await rawUpload(header, new Uint8Array(MAX_ATTACHMENT_BYTES + 1), "image/png", "m5-large"),
			413,
			"payload_too_large",
		);
	});

	it.each(["raw", "multipart"])("bounds keyed chunked %s uploads before hashing", async (kind) => {
		const { header } = await setup();
		let sent = 0;
		const chunk = new Uint8Array(1024 * 1024);
		const response = await fetch(`${base}${memoryPath}`, {
			method: "POST",
			headers: {
				Authorization: header,
				"Content-Type": kind === "raw" ? "image/png" : "multipart/form-data; boundary=x",
				"X-Filename": "big.png",
				"Idempotency-Key": `m5-chunked-${kind}`,
			},
			body: new ReadableStream({
				pull(controller) {
					if (sent > MAX_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
						controller.close();
						return;
					}
					controller.enqueue(chunk);
					sent += chunk.byteLength;
				},
			}),
			duplex: "half",
		} as RequestInit);
		await expectError(response, 413, "payload_too_large");
	});

	it("bounds multipart envelope and extra-field bytes", async () => {
		const { header } = await setup();
		const form = new FormData();
		form.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
		const encoded = new Request(`${base}${memoryPath}`, { method: "POST", body: form });
		const bytes = new Uint8Array(await encoded.arrayBuffer());
		const padded = new Uint8Array(bytes.length + MAX_MULTIPART_OVERHEAD_BYTES);
		padded.set(bytes);
		await expectError(
			await fetch(`${base}${memoryPath}`, {
				method: "POST",
				headers: {
					Authorization: header,
					"Content-Type": encoded.headers.get("Content-Type") ?? "",
				},
				body: padded,
			}),
			413,
			"payload_too_large",
		);
		const extra = new FormData();
		extra.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
		extra.append(
			"note",
			new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES)]),
			"extra.bin",
		);
		await expectError(await multipartUpload(header, extra), 413, "payload_too_large");
	});
});
