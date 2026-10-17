import { describe, expect, it, vi } from "vitest";
import type { ApiPrincipal } from "../auth/authorize";
import { ApiError } from "../lib/errors";
import type { AttachmentRepo } from "./repo";
import { AttachmentService } from "./service";

function principal(overrides: Partial<ApiPrincipal> = {}): ApiPrincipal {
	return {
		id: "k1",
		name: "bot",
		role: "admin",
		ops: new Set(["r", "u", "d"]),
		scope: "all",
		spaceIds: [],
		ownedSpaceIds: ["s1"],
		ownEntriesOnly: false,
		autoOwnSpace: false,
		expiresAt: null,
		...overrides,
	};
}

function serviceWith(
	repo: Partial<AttachmentRepo>,
	blobs: {
		put: ReturnType<typeof vi.fn>;
		get?: ReturnType<typeof vi.fn>;
		delete?: ReturnType<typeof vi.fn>;
	},
	extra: Partial<ConstructorParameters<typeof AttachmentService>[0]> = {},
) {
	return new AttachmentService({
		repo: repo as AttachmentRepo,
		blobs: {
			put: blobs.put as (
				key: string,
				data: ArrayBuffer | Uint8Array,
				meta: { contentType: string; sha256: string },
			) => Promise<void>,
			get: (blobs.get ?? vi.fn()) as (key: string) => Promise<null>,
			delete: (blobs.delete ?? vi.fn().mockResolvedValue(undefined)) as (
				key: string,
			) => Promise<void>,
		},
		urlSecret: "secret",
		publicOrigin: "https://octo.test",
		ttlSeconds: 300,
		now: () => 1_700_000_000_000,
		...extra,
	});
}

const memory = {
	id: "m1",
	space_id: "s1",
	source_key_id: "k1",
	deleted_at: null,
};

describe("AttachmentService", () => {
	it("uploads when authorized", async () => {
		const put = vi.fn();
		const insertAttachment = vi.fn();
		const svc = serviceWith(
			{ getMemory: vi.fn().mockResolvedValue(memory), insertAttachment },
			{ put },
		);
		const body = await svc.upload(principal(), "m1", {
			filename: "a.png",
			contentType: "image/png",
			bytes: new Uint8Array([1]),
		});
		expect(body.markdown).toBe(`![](octo://att/${body.id})`);
		expect(put).toHaveBeenCalled();
		expect(insertAttachment).toHaveBeenCalled();
	});

	it("deletes blob when metadata insert fails", async () => {
		const put = vi.fn();
		const del = vi.fn();
		const insertAttachment = vi.fn().mockRejectedValue(new Error("d1 down"));
		const svc = serviceWith(
			{
				getMemory: vi.fn().mockResolvedValue(memory),
				insertAttachment,
				getAttachment: vi.fn().mockResolvedValue(null),
			},
			{ put, delete: del },
		);
		await expect(
			svc.upload(principal(), "m1", {
				filename: "a.png",
				contentType: "image/png",
				bytes: new Uint8Array([1]),
			}),
		).rejects.toThrow("d1 down");
		expect(del).toHaveBeenCalledWith(expect.stringMatching(/^att\/m1\//));
	});

	it.each(["committed", "unknown"])("preserves blob when metadata is %s", async (state) => {
		const del = vi.fn();
		const insertAttachment = vi.fn().mockRejectedValue(new Error("commit acknowledgement lost"));
		const getAttachment =
			state === "committed"
				? vi.fn().mockResolvedValue({ id: "committed" })
				: vi.fn().mockRejectedValue(new Error("verification unavailable"));
		const svc = serviceWith(
			{ getMemory: vi.fn().mockResolvedValue(memory), insertAttachment, getAttachment },
			{ put: vi.fn(), delete: del },
		);
		await expect(
			svc.upload(principal(), "m1", {
				filename: "a.png",
				contentType: "image/png",
				bytes: new Uint8Array([1]),
			}),
		).rejects.toThrow("commit acknowledgement lost");
		expect(getAttachment).toHaveBeenCalledWith(insertAttachment.mock.calls[0]?.[0].id);
		expect(del).not.toHaveBeenCalled();
	});

	it("forbids list without read op", async () => {
		const svc = serviceWith({ getMemory: vi.fn().mockResolvedValue(memory) }, { put: vi.fn() });
		await expect(svc.list(principal({ ops: new Set(["u", "d"]) }), "m1")).rejects.toMatchObject({
			code: "forbidden",
		});
	});

	it("forbids read when scope hidden", async () => {
		const svc = serviceWith({ getMemory: vi.fn().mockResolvedValue(memory) }, { put: vi.fn() });
		await expect(
			svc.list(principal({ scope: "own", ownedSpaceIds: ["other"] }), "m1"),
		).rejects.toMatchObject({ code: "not_found" });
	});

	it("denies forbidden upload with own_entries_only", async () => {
		const svc = serviceWith(
			{
				getMemory: vi.fn().mockResolvedValue({
					...memory,
					source_key_id: "other",
				}),
			},
			{ put: vi.fn() },
		);
		await expect(
			svc.upload(principal({ ownEntriesOnly: true }), "m1", {
				filename: "a.png",
				contentType: "image/png",
				bytes: new Uint8Array([1]),
			}),
		).rejects.toBeInstanceOf(ApiError);
	});

	it("returns not found for missing memory", async () => {
		const svc = serviceWith({ getMemory: vi.fn().mockResolvedValue(null) }, { put: vi.fn() });
		await expect(svc.list(principal(), "missing")).rejects.toMatchObject({ code: "not_found" });
	});

	it("returns not found when delete races", async () => {
		const attachment = {
			id: "a1",
			memory_id: "m1",
			r2_key: "att/m1/a1",
			filename: "a.png",
			content_type: "image/png",
			size_bytes: 1,
			sha256: "h",
			created_by: "k",
			created_at: 1,
			deleted_at: null,
		};
		const svc = serviceWith(
			{
				getAttachment: vi.fn().mockResolvedValue(attachment),
				getMemory: vi.fn().mockResolvedValue(memory),
				softDelete: vi.fn().mockResolvedValue(false),
			},
			{ put: vi.fn() },
		);
		await expect(svc.delete(principal(), "a1")).rejects.toMatchObject({ code: "not_found" });
	});

	it("deletes attachments", async () => {
		const attachment = {
			id: "a1",
			memory_id: "m1",
			r2_key: "att/m1/a1",
			filename: "a.png",
			content_type: "image/png",
			size_bytes: 1,
			sha256: "h",
			created_by: "k",
			created_at: 1,
			deleted_at: null,
		};
		const softDelete = vi.fn().mockResolvedValue(true);
		const svc = serviceWith(
			{
				getAttachment: vi.fn().mockResolvedValue(attachment),
				getMemory: vi.fn().mockResolvedValue(memory),
				softDelete,
			},
			{ put: vi.fn() },
		);
		await svc.delete(principal(), "a1");
		expect(softDelete).toHaveBeenCalled();
	});

	it("hides deleted attachments for url", async () => {
		const svc = serviceWith(
			{
				getAttachment: vi.fn().mockResolvedValue({
					id: "a1",
					memory_id: "m1",
					r2_key: "att/m1/a1",
					filename: "a.png",
					content_type: "image/png",
					size_bytes: 1,
					sha256: "h",
					created_by: "k",
					created_at: 1,
					deleted_at: 1,
				}),
			},
			{ put: vi.fn() },
		);
		await expect(svc.signedUrl(principal(), "a1")).rejects.toMatchObject({ code: "not_found" });
	});

	it("forbids delete without permission", async () => {
		const attachment = {
			id: "a1",
			memory_id: "m1",
			r2_key: "att/m1/a1",
			filename: "a.png",
			content_type: "image/png",
			size_bytes: 1,
			sha256: "h",
			created_by: "k",
			created_at: 1,
			deleted_at: null,
		};
		const svc = serviceWith(
			{
				getAttachment: vi.fn().mockResolvedValue(attachment),
				getMemory: vi.fn().mockResolvedValue(memory),
			},
			{ put: vi.fn() },
		);
		await expect(svc.delete(principal({ ops: new Set(["r"]) }), "a1")).rejects.toMatchObject({
			code: "forbidden",
		});
	});

	it("uses default ttl when zero", async () => {
		const attachment = {
			id: "a1",
			memory_id: "m1",
			r2_key: "att/m1/a1",
			filename: "a.png",
			content_type: "image/png",
			size_bytes: 1,
			sha256: "h",
			created_by: "k",
			created_at: 1,
			deleted_at: null,
		};
		const svc = serviceWith(
			{
				getAttachment: vi.fn().mockResolvedValue(attachment),
				getMemory: vi.fn().mockResolvedValue(memory),
			},
			{ put: vi.fn() },
			{ ttlSeconds: 0, now: () => 0 },
		);
		const out = await svc.signedUrl(principal(), "a1");
		expect(out.expires_at).toBe(new Date(300_000).toISOString());
	});

	it("returns signed url", async () => {
		const attachment = {
			id: "a1",
			memory_id: "m1",
			r2_key: "att/m1/a1",
			filename: "a.png",
			content_type: "image/png",
			size_bytes: 1,
			sha256: "h",
			created_by: "k",
			created_at: 1,
			deleted_at: null,
		};
		const svc = serviceWith(
			{
				getAttachment: vi.fn().mockResolvedValue(attachment),
				getMemory: vi.fn().mockResolvedValue(memory),
			},
			{ put: vi.fn() },
		);
		const out = await svc.signedUrl(principal(), "a1");
		expect(out.url).toContain("/files/att/m1/a1?exp=");
		expect(out.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});
