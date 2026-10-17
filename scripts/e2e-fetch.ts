export async function e2eFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (cause) {
		const { origin, pathname } = new URL(url);
		throw new Error(`L2 request failed: ${init?.method ?? "GET"} ${origin}${pathname}`, { cause });
	}
}
