import { APP_VERSION, versionLabel } from "../../lib/version";
import { sha256Hex } from "../http/crypto";

export type AuthorProfile = { name: string | null; avatar: string | null };

function avatarUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

export async function fetchAuthorProfile(email: string): Promise<AuthorProfile> {
	const empty: AuthorProfile = { name: null, avatar: null };
	try {
		const hash = await sha256Hex(email.trim().toLowerCase());
		const response = await fetch(`https://lizheng.blog/api/authors/profile?hash=${hash}`, {
			headers: { Accept: "application/json", "User-Agent": versionLabel(APP_VERSION) },
			redirect: "error",
			signal: AbortSignal.timeout(2500),
		});
		if (!response.ok) return empty;
		const data: unknown = await response.json();
		if (!data || typeof data !== "object" || Array.isArray(data)) return empty;
		const profile = data as Record<string, unknown>;
		return {
			name: typeof profile.name === "string" ? profile.name.trim() || null : null,
			avatar: avatarUrl(profile.avatar),
		};
	} catch {
		return empty;
	}
}
