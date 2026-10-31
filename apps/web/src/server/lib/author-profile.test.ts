import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION, versionLabel } from "../../lib/version";
import { fetchAuthorProfile } from "./author-profile";

const emailHash = "7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217";
const pngAvatar =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function profileCache() {
	let now = 0;
	const entries = new Map<string, { response: Response; expires: number }>();
	const cache = {
		match: vi.fn(async (key: string) => {
			const entry = entries.get(key);
			return entry && entry.expires > now ? entry.response.clone() : undefined;
		}),
		put: vi.fn(async (key: string, response: Response) => {
			const ttl = Number(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1]);
			entries.set(key, { response: response.clone(), expires: now + ttl });
		}),
	};
	vi.stubGlobal("caches", { default: cache });
	return { ...cache, advance: (seconds: number) => (now += seconds) };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("author profile enrichment", () => {
	it.each(["architie@gmail.com", "  Architie@Gmail.com "])(
		"matches the published SHA-256 vector for %s",
		async (email) => {
			const request = vi.fn(async () => Response.json({ name: "Zheng Li", avatar: pngAvatar }));
			vi.stubGlobal("fetch", request);
			expect(await fetchAuthorProfile(email)).toEqual({ name: "Zheng Li", avatar: pngAvatar });
			expect(request).toHaveBeenCalledWith(
				`https://lizheng.blog/api/authors/profile?hash=${emailHash}`,
				expect.anything(),
			);
		},
	);

	it("uses the injected transport without reaching the real network", async () => {
		const network = vi.fn();
		const fetcher = {
			fetch: vi.fn(async () => Response.json({ name: "Zheng Li", avatar: pngAvatar })),
		};
		vi.stubGlobal("fetch", network);
		expect(await fetchAuthorProfile("architie@gmail.com", fetcher)).toEqual({
			name: "Zheng Li",
			avatar: pngAvatar,
		});
		expect(fetcher.fetch).toHaveBeenCalledOnce();
		expect(network).not.toHaveBeenCalled();
	});

	it("invokes the default fetcher without an illegal invocation", async () => {
		const request = vi.fn(async () => Response.json({ name: "Zheng Li", avatar: pngAvatar }));
		vi.stubGlobal("fetch", request);
		expect(await fetchAuthorProfile("architie@gmail.com")).toEqual({
			name: "Zheng Li",
			avatar: pngAvatar,
		});
		expect(request).toHaveBeenCalledOnce();
		const init = (request.mock.calls[0] as unknown as [string, RequestInit] | undefined)?.[1];
		expect(init?.redirect).toBe("manual");
	});

	it("treats redirect responses as unavailable", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(null, { status: 302, headers: { Location: "https://lizheng.blog/other" } }),
				),
		);
		expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
		expect(warn).toHaveBeenCalledWith("author profile unavailable", { kind: "http", status: 302 });
	});

	it.each([429, 500, 503])("warns on profile HTTP %s without leaking identity", async (status) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
		expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
		expect(warn).toHaveBeenCalledWith("author profile unavailable", { kind: "http", status });
	});

	it.each([new Error("offline"), new DOMException("timed out", "TimeoutError")])(
		"warns on an unavailable profile service: %s",
		async (error) => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
			expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
			expect(warn).toHaveBeenCalledWith(
				"author profile unavailable",
				error instanceof DOMException && error.name === "TimeoutError"
					? { kind: "timeout" }
					: { kind: "network" },
			);
		},
	);

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
		expect(options.redirect).toBe("manual");
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

	it.each([
		"not a URL",
		"javascript:alert(1)",
		"http://example.test/avatar.png",
		"https://user:password@example.test/avatar.png",
		"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
		"data:text/html;base64,PGgxPmhpPC9oMT4=",
		"data:image/png;base64,",
		"data:image/png;base64,a===",
		"data:image/png;base64,aW52YWxpZA==\n",
		"data:image/png;base64,aW52YWxpZA==\r",
		`data:image/png;base64,${"a".repeat(16_384)}`,
		"",
	])("does not expose an unsafe avatar URL: %s", async (avatar) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ name: "Owner", avatar })));
		expect(await fetchAuthorProfile("owner@example.test")).toEqual({
			name: "Owner",
			avatar: null,
		});
	});

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
			vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
			expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
		},
	);

	it.each([new Error("offline"), new DOMException("timed out", "TimeoutError")])(
		"tolerates an unavailable profile service",
		async (error) => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
			expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
		},
	);

	it("tolerates an invalid JSON response", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
		expect(await fetchAuthorProfile("owner@example.test")).toEqual({ name: null, avatar: null });
	});

	it("stores only sanitized profile data under a hash-only key for 24 hours", async () => {
		const cache = profileCache();
		const request = vi.fn(async () =>
			Response.json({
				name: " Zheng Li ",
				avatar: pngAvatar,
				email: "architie@gmail.com",
				id: "secret",
			}),
		);
		vi.stubGlobal("fetch", request);
		const profile = { name: "Zheng Li", avatar: pngAvatar };
		expect(await fetchAuthorProfile("architie@gmail.com")).toEqual(profile);
		const [key, response] = cache.put.mock.calls[0] as [string, Response];
		expect(key).toBe(`https://octo.hexly.ai/_author-profiles/v2/${emailHash}`);
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
		expect(await response.json()).toEqual(profile);
		cache.advance(86_399);
		expect(await fetchAuthorProfile("  Architie@Gmail.com ")).toEqual(profile);
		expect(request).toHaveBeenCalledOnce();
		cache.advance(1);
		expect(await fetchAuthorProfile("architie@gmail.com")).toEqual(profile);
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("caches a normal null profile for one hour and isolates different hashes", async () => {
		const cache = profileCache();
		const request = vi.fn(async () => Response.json({ name: null, avatar: null }));
		vi.stubGlobal("fetch", request);
		expect(await fetchAuthorProfile("architie@gmail.com")).toEqual({ name: null, avatar: null });
		expect(cache.put.mock.calls[0]?.[1].headers.get("Cache-Control")).toBe("public, max-age=3600");
		cache.advance(3_599);
		await fetchAuthorProfile("architie@gmail.com");
		expect(request).toHaveBeenCalledOnce();
		await fetchAuthorProfile("another@example.test");
		expect(request).toHaveBeenCalledTimes(2);
		cache.advance(1);
		await fetchAuthorProfile("architie@gmail.com");
		expect(request).toHaveBeenCalledTimes(3);
	});

	it.each([429, 500, 503, "network", "timeout", "json"] as const)(
		"caches unavailable profile %s for five minutes before retrying",
		async (failure) => {
			const cache = profileCache();
			const request = vi.fn(async () => {
				if (failure === "network") throw new Error("offline");
				if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
				return failure === "json"
					? new Response("invalid")
					: new Response(null, { status: failure });
			});
			vi.stubGlobal("fetch", request);
			expect(await fetchAuthorProfile("architie@gmail.com")).toEqual({ name: null, avatar: null });
			expect(cache.put.mock.calls[0]?.[1].headers.get("Cache-Control")).toBe("public, max-age=300");
			cache.advance(299);
			await fetchAuthorProfile("architie@gmail.com");
			expect(request).toHaveBeenCalledOnce();
			cache.advance(1);
			await fetchAuthorProfile("architie@gmail.com");
			expect(request).toHaveBeenCalledTimes(2);
		},
	);

	it.each(["read", "write", "json"])("keeps cache %s failures optional", async (failure) => {
		const cache = profileCache();
		if (failure === "read") cache.match.mockRejectedValueOnce(new Error("cache unavailable"));
		if (failure === "write") cache.put.mockRejectedValueOnce(new Error("cache unavailable"));
		if (failure === "json") cache.match.mockResolvedValueOnce(new Response("invalid"));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ name: "Zheng Li", avatar: pngAvatar })),
		);
		expect(await fetchAuthorProfile("architie@gmail.com")).toEqual({
			name: "Zheng Li",
			avatar: pngAvatar,
		});
	});

	it("sanitizes cache hits before returning them", async () => {
		const cache = profileCache();
		cache.match.mockResolvedValueOnce(
			Response.json({ name: " Zheng Li ", avatar: "javascript:alert(1)", email: "private" }),
		);
		const network = vi.fn();
		vi.stubGlobal("fetch", network);
		expect(await fetchAuthorProfile("architie@gmail.com")).toEqual({
			name: "Zheng Li",
			avatar: null,
		});
		expect(network).not.toHaveBeenCalled();
	});

	it("does not expose identity data when hashing fails", async () => {
		const network = vi.fn();
		vi.stubGlobal("fetch", network);
		vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new Error("crypto unavailable"));
		expect(await fetchAuthorProfile("architie@gmail.com")).toEqual({ name: null, avatar: null });
		expect(network).not.toHaveBeenCalled();
	});
});
