import { createServer } from "node:http";

export async function startGateway(secret: string) {
	const observations: { authorized: boolean; userAgent: string; model: string; path: string }[] =
		[];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string };
		const observation = {
			authorized: request.headers.authorization === `Bearer ${secret}`,
			userAgent: request.headers["user-agent"] ?? "",
			model: payload.model,
			path: request.url ?? "",
		};
		observations.push(observation);
		response.setHeader("Content-Type", "application/json");
		if (
			!observation.authorized ||
			!observation.userAgent.startsWith("octo/") ||
			request.method !== "POST" ||
			observation.path !== "/v1/embeddings"
		) {
			response.statusCode = 400;
			response.end(JSON.stringify({ error: { message: "Invalid local embedding request" } }));
			return;
		}
		response.end(
			JSON.stringify({
				data: [
					{
						index: 0,
						embedding: Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)),
					},
				],
			}),
		);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Local gateway did not bind TCP");
	return {
		url: `http://127.0.0.1:${address.port}`,
		observations,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}
