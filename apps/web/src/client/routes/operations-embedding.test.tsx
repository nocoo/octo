import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EmbeddingModel } from "../viewmodels/operations-embedding";
import { EmbeddingPage } from "./operations-embedding";

const fixture = vi.hoisted(() => ({ state: {} as Partial<EmbeddingModel["state"]> }));
vi.mock("../viewmodels/operations-embedding", async (original) => {
	const module = await original<typeof import("../viewmodels/operations-embedding")>();
	return {
		...module,
		EmbeddingModel: class extends module.EmbeddingModel {
			constructor() {
				super();
				this.state = { ...this.state, ...fixture.state };
			}
		},
	};
});

describe("embedding configuration visibility", () => {
	it.each([null, "Unable to load embedding settings."])(
		"keeps unknown settings out of the editor with error %s",
		(error) => {
			fixture.state = { loaded: false, error };
			const html = renderToStaticMarkup(<EmbeddingPage />);
			expect(html).not.toContain("No API key configured");
			expect(html).not.toContain("text-embedding-3-small");
			expect(html).not.toContain("<form");
			expect(html).not.toContain("Save settings");
			expect(html).not.toContain("Clear saved key");
			expect(html).toContain("configuration is unknown");
			if (error) expect(html).toContain(error);
		},
	);

	it("retains loaded stale values and the visible refresh error", () => {
		fixture.state = {
			loaded: true,
			error: "Unable to load embedding settings.",
			config: {
				base_url: "https://gateway.example",
				model: "active-model",
				dims: 512,
				backfill_enabled: true,
				api_key_set: true,
				api_key_suffix: "abcd",
			},
		};
		const html = renderToStaticMarkup(<EmbeddingPage />);
		expect(html).toContain("Unable to load embedding settings.");
		expect(html).toContain('value="active-model"');
		expect(html).toContain("abcd");
		expect(html).toContain("<form");
		expect(html).toContain("Save settings");
		expect(html).not.toContain("disabled=");
	});
});
