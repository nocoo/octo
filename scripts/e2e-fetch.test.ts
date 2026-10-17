import { describe, expect, it, vi } from "vitest";
import { e2eFetch } from "./e2e-fetch";

describe("e2e fetch diagnostics", () => {
	it("preserves responses and status codes without retrying", async () => {
		const response = new Response("failure", { status: 500 });
		const fetch = vi.fn().mockResolvedValue(response);
		vi.stubGlobal("fetch", fetch);
		const init = { method: "POST", body: "x" };
		expect(await e2eFetch("http://127.0.0.1:9/upload", init)).toBe(response);
		expect(fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:9/upload", init);
	});

	it("labels requests without an explicit method as GET", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
		await expect(e2eFetch("http://127.0.0.1:9/api/live")).rejects.toThrow(
			"L2 request failed: GET http://127.0.0.1:9/api/live",
		);
	});

	it.each(["GET", "POST"])(
		"identifies failed %s requests without leaking queries or auth",
		async (method) => {
			const cause = new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
			const fetch = vi.fn().mockRejectedValue(cause);
			vi.stubGlobal("fetch", fetch);
			const url = new URL("http://127.0.0.1:9/files/att/m/a?sig=private&exp=1");
			try {
				await e2eFetch(url, { method, headers: { Authorization: "Bearer private" } });
				throw new Error("expected fetch to fail");
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe(
					`L2 request failed: ${method} http://127.0.0.1:9/files/att/m/a`,
				);
				expect((error as Error).cause).toBe(cause);
			}
			expect(fetch).toHaveBeenCalledOnce();
		},
	);
});
