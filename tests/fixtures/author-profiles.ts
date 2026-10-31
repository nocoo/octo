import type { Env } from "../../apps/web/src/server/env";
import type {
	AuthorProfile,
	AuthorProfileFetcher,
} from "../../apps/web/src/server/lib/author-profile";
import {
	authorProfileOutboundFetch,
	PROFILE_AVATAR,
	profileForHash,
} from "./author-profile-outbound-data";

export { PROFILE_AVATAR } from "./author-profile-outbound-data";
export const BROKEN_PROFILE_AVATAR = "data:image/png;base64,aW52YWxpZA==";

const profile = { name: "Zheng Li", avatar: PROFILE_AVATAR };

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
			profileForHash(url.searchParams.get("hash") ?? "") satisfies AuthorProfile,
		);
	},
};

export { authorProfileOutboundFetch };

export function profileTestEnv(env: Env): Env {
	if (env.RESOURCE_ENV !== "test")
		throw new Error("profile fixture requires isolated test resources");
	return { ...env, AUTHOR_PROFILE_FETCHER: fetcher };
}

export { profile };
