import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type EmbedderStub = {
	baseUrl: string;
	getLastUserAgent: () => string | null;
	close: () => Promise<void>;
};

export function startLocalEmbedderStub(expectedUserAgent: string): Promise<EmbedderStub> {
	let lastUserAgent: string | null = null;
	let server: Server | undefined;
	return new Promise((resolve, reject) => {
		server = createServer((req, res) => {
			lastUserAgent = req.headers["user-agent"] ?? null;
			if (req.url !== "/v1/embeddings" || req.method !== "POST") {
				res.writeHead(404);
				res.end();
				return;
			}
			if (lastUserAgent !== expectedUserAgent) {
				res.writeHead(403);
				res.end("forbidden");
				return;
			}
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				try {
					const parsed = JSON.parse(body) as { input?: string[] };
					const inputs = parsed.input ?? [];
					res.writeHead(200, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							data: inputs.map(() => ({ embedding: [3, 4] })),
						}),
					);
				} catch {
					res.writeHead(400);
					res.end();
				}
			});
		});
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server?.address() as AddressInfo;
			resolve({
				baseUrl: `http://127.0.0.1:${addr.port}`,
				getLastUserAgent: () => lastUserAgent,
				close: async () => {
					await new Promise<void>((done) => server?.close(() => done()));
				},
			});
		});
	});
}
