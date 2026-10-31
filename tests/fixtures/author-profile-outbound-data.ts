export const PROFILE_AVATAR =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const profiles = new Map<string, { name: string | null; avatar: string | null }>([
	[
		"a5bee6c52fb85571876946dd591ab494c04397e622dedec8d6ecfa2a787876ec",
		{ name: "Zheng Li", avatar: PROFILE_AVATAR },
	],
	[
		"7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217",
		{ name: "Zheng Li", avatar: PROFILE_AVATAR },
	],
	[
		"ee7c2b2a38c9655a0528b9bcb542e545f278f76de7bc2b368583b9f15c7e9e86",
		{ name: "Zheng Li", avatar: "data:image/png;base64,aW52YWxpZA==" },
	],
]);

export function authorProfileOutboundFetch(request: Request): Response {
	const url = new URL(request.url);
	if (
		url.origin !== "https://lizheng.blog" ||
		url.pathname !== "/api/authors/profile" ||
		![...url.searchParams.keys()].every((key) => key === "hash")
	)
		return new Response("unexpected outbound request", { status: 502 });
	return Response.json(
		profiles.get(url.searchParams.get("hash") ?? "") ?? { name: null, avatar: null },
	);
}

export function profileForHash(hash: string): { name: string | null; avatar: string | null } {
	return profiles.get(hash) ?? { name: null, avatar: null };
}
