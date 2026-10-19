import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

type StubRequest = { userAgent: string | null; authorization: string | null; body: unknown };
export type EmbedderStub = {
	baseUrl: string;
	getLastRequest: () => StubRequest | undefined;
	close: () => Promise<void>;
};

type StubOptions = {
	embedding?: number[];
	delayMs?: number;
	status?: number;
	responseBody?: object;
};

export function startLocalEmbedderStub(
	expectedUserAgent: string,
	options: StubOptions = {},
): Promise<EmbedderStub> {
	let lastRequest: StubRequest | undefined;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const server = createServer((req, res) => {
		if (req.url !== "/v1/embeddings" || req.method !== "POST") {
			res.writeHead(404).end();
			return;
		}
		if (req.headers["user-agent"] !== expectedUserAgent) {
			res.writeHead(403).end();
			return;
		}
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			let parsed: { input?: string[] };
			try {
				parsed = JSON.parse(body) as { input?: string[] };
			} catch {
				res.writeHead(400).end();
				return;
			}
			lastRequest = {
				userAgent: req.headers["user-agent"] ?? null,
				authorization: req.headers.authorization ?? null,
				body: parsed,
			};
			const respond = () => {
				res.writeHead(options.status ?? 200, { "content-type": "application/json" });
				res.end(
					JSON.stringify(
						options.responseBody ?? {
							data: (parsed.input ?? []).map((_text, index) => ({
								index,
								embedding: options.embedding ?? [3, 4],
							})),
						},
					),
				);
			};
			if (options.delayMs) timers.add(setTimeout(respond, options.delayMs));
			else respond();
		});
	});
	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve({
				baseUrl: `http://127.0.0.1:${address.port}`,
				getLastRequest: () => lastRequest,
				close: async () => {
					for (const timer of timers) clearTimeout(timer);
					server.closeAllConnections();
					await new Promise<void>((done) => server.close(() => done()));
				},
			});
		});
	});
}
