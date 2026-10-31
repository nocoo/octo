import { APP_VERSION, versionLabel } from "../../lib/version";
import { sha256Hex } from "../http/crypto";

export type AuthorProfile = { name: string | null; avatar: string | null };
export type AuthorProfileFetcher = Pick<Fetcher, "fetch">;

const defaultFetcher: AuthorProfileFetcher = {
	fetch: (input, init) => fetch(input, init),
};

function avatarUrl(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 16_384) return null;
	if (
		value.length > "data:image/png;base64,".length &&
		/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			value,
		)
	)
		return value;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
	} catch {
		return null;
	}
}

function authorProfile(data: unknown): AuthorProfile {
	if (!data || typeof data !== "object" || Array.isArray(data)) return { name: null, avatar: null };
	const profile = data as Record<string, unknown>;
	return {
		name: typeof profile.name === "string" ? profile.name.trim() || null : null,
		avatar: avatarUrl(profile.avatar),
	};
}

function warnProfileFailure(kind: "http" | "network" | "timeout", status?: number): void {
	console.warn("author profile unavailable", status === undefined ? { kind } : { kind, status });
}

export async function fetchAuthorProfile(
	email: string,
	fetcher: AuthorProfileFetcher = defaultFetcher,
): Promise<AuthorProfile> {
	const empty: AuthorProfile = { name: null, avatar: null };
	try {
		const hash = await sha256Hex(email.trim().toLowerCase());
		const key = `https://octo.hexly.ai/_author-profiles/v2/${hash}`;
		const cache = typeof caches === "undefined" ? undefined : caches.default;
		const cached = await cache?.match(key).catch(() => undefined);
		if (cached) {
			const data: unknown = await cached.json().catch(() => undefined);
			if (data !== undefined) return authorProfile(data);
		}
		let profile = empty;
		let maxAge = 300;
		try {
			const response = await fetcher.fetch(
				`https://lizheng.blog/api/authors/profile?hash=${hash}`,
				{
					headers: { Accept: "application/json", "User-Agent": versionLabel(APP_VERSION) },
					redirect: "manual",
					signal: AbortSignal.timeout(2500),
				},
			);
			if (response.ok) {
				profile = authorProfile(await response.json());
				maxAge = profile.name || profile.avatar ? 86_400 : 3_600;
			} else {
				warnProfileFailure("http", response.status);
			}
		} catch (error) {
			const kind =
				error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network";
			warnProfileFailure(kind);
			profile = empty;
		}
		await cache
			?.put(
				key,
				Response.json(profile, { headers: { "Cache-Control": `public, max-age=${maxAge}` } }),
			)
			.catch(() => undefined);
		return profile;
	} catch {
		return empty;
	}
}
