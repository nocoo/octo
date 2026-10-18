import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION, versionLabel } from "../../lib/version";
import { fetchAuthorProfile } from "./author-profile";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("author profile enrichment", () => {
	it("looks up the normalized email hash without sending the email", async () => {
		const request = vi
			.fn()
			.mockResolvedValue(
				Response.json({ name: "  Li Zheng  ", avatar: "https://lizheng.blog/avatar.png" }),
			);
		vi.stubGlobal("fetch", request);
		const timeout = vi.spyOn(AbortSignal, "timeout");
		expect(await fetchAuthorProfile(" Owner@Example.Test ")).toEqual({
			name: "Li Zheng",
			avatar: "https://lizheng.blog/avatar.png",
		});
		const [input, options] = request.mock.calls[0] as [string, RequestInit];
		const url = new URL(input);
		expect(url.origin + url.pathname).toBe("https://lizheng.blog/api/authors/profile");
		expect(url.searchParams.get("hash")).toBe(
			createHash("sha256").update("owner@example.test").digest("hex"),
		);
		expect(input).not.toContain("Owner");
		expect(input).not.toContain("example.test");
		expect(options.redirect).toBe("error");
		expect(new Headers(options.headers).get("User-Agent")).toBe(versionLabel(APP_VERSION));
		expect(options.signal).toBeInstanceOf(AbortSignal);
		expect(timeout).toHaveBeenCalledWith(2500);
	});

	it.each([null, [], "profile", {}, { name: " ", avatar: 42 }])(
		"treats an incomplete profile as optional identity data: %j",
		async (payload) => {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
			expect(await fetchAuthorProfile("owner@example.test")).toEqual({
				name: null,
				avatar: null,
			});
		},
	);

	it.each(["not a URL", "javascript:alert(1)", "http://example.test/avatar.png", ""])(
		"does not expose an unsafe avatar URL: %s",
		async (avatar) => {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ name: "Owner", avatar })));
			expect(await fetchAuthorProfile("owner@example.test")).toEqual({
				name: "Owner",
				avatar: null,
			});
		},
	);

	it("keeps a valid avatar when the display name is absent", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({ avatar: "https://example.test/avatar.png" })),
		);
		expect(await fetchAuthorProfile("owner@example.test")).toEqual({
			name: null,
			avatar: "https://example.test/avatar.png",
		});
	});

	it.each([404, 503])(
		"does not turn profile HTTP %s into an authentication failure",
		async (status) => {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
			expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
		},
	);

	it.each([new Error("offline"), new DOMException("timed out", "TimeoutError")])(
		"tolerates an unavailable profile service",
		async (error) => {
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
			expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
		},
	);

	it("tolerates an invalid JSON response", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
		expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
	});
});
