/** Brief pause after synchronous wrangler D1 CLI writes while the worker holds the same DB. */
export async function afterD1Exec(ms = 200): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
	url: string,
	init?: RequestInit,
	attempts = 4,
): Promise<Response> {
	let lastErr: unknown;
	for (let i = 0; i < attempts; i += 1) {
		try {
			return await fetch(url, init);
		} catch (err) {
			lastErr = err;
			await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
		}
	}
	throw lastErr;
}
