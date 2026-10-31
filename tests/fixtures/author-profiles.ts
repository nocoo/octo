import type { Env } from "../../apps/web/src/server/env";
import type {
	AuthorProfile,
	AuthorProfileFetcher,
} from "../../apps/web/src/server/lib/author-profile";

export const PROFILE_AVATAR =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
export const BROKEN_PROFILE_AVATAR = "data:image/png;base64,aW52YWxpZA==";

const profile = { name: "Zheng Li", avatar: PROFILE_AVATAR };
const profiles = new Map<string, AuthorProfile>([
	["a5bee6c52fb85571876946dd591ab494c04397e622dedec8d6ecfa2a787876ec", profile],
	["7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217", profile],
	[
		"ee7c2b2a38c9655a0528b9bcb542e545f278f76de7bc2b368583b9f15c7e9e86",
		{ name: "Zheng Li", avatar: BROKEN_PROFILE_AVATAR },
	],
]);

const fetcher: AuthorProfileFetcher = {
	async fetch(input) {
		const url = new URL(input instanceof Request ? input.url : input);
		if (
			url.origin !== "https://lizheng.blog" ||
			url.pathname !== "/api/authors/profile" ||
			![...url.searchParams.keys()].every((key) => key === "hash")
		)
			throw new Error("profile fixture received an unexpected request");
		return Response.json(
			profiles.get(url.searchParams.get("hash") ?? "") ?? { name: null, avatar: null },
		);
	},
};

export function profileTestEnv(env: Env): Env {
	if (env.RESOURCE_ENV !== "test")
		throw new Error("profile fixture requires isolated test resources");
	return { ...env, AUTHOR_PROFILE_FETCHER: fetcher };
}
