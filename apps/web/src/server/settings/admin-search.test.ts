import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayEmbedder } from "../ports/embedder/gateway";
import { searchMemories } from "../search/service";
import { fixture, SETTINGS } from "./__tests__/fixture";
import { searchAdminMemories } from "./admin-search";
import { saveEmbeddingSettings } from "./config";

vi.mock("../search/service", () => ({
	searchMemories: vi.fn(async () => ({
		items: [],
		channels: {
			fts: { candidates: 0, partial: false },
			vector: { candidates: 0, truncated: false, profile: null },
		},
	})),
}));

const authz = { keyId: "admin:local", visibleSpaceIds: "all" as const };

describe("Access dashboard query embeddings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("embeds configured text for hybrid search without exposing credentials", async () => {
		const { env } = fixture();
		await saveEmbeddingSettings(env, SETTINGS, "admin:local");
		const embed = vi.spyOn(GatewayEmbedder.prototype, "embed").mockResolvedValue([[1, 0, 0]]);
		const response = await searchAdminMemories(env, authz, { query: "knowledge" });
		expect(embed).toHaveBeenCalledWith(["knowledge"]);
		expect(vi.mocked(searchMemories).mock.calls[0]?.[1]).toEqual({
			query: "knowledge",
			mode: "hybrid",
			vector: { profile: "tiny", values: [1, 0, 0] },
		});
		expect(JSON.stringify(response)).not.toContain(SETTINGS.api_key);
		embed.mockRestore();
	});

	it.each(["fts", "vector"] as const)("respects explicit %s mode", async (mode) => {
		const { env } = fixture();
		await saveEmbeddingSettings(env, SETTINGS, "admin:local");
		const embed = vi.spyOn(GatewayEmbedder.prototype, "embed").mockResolvedValue([[1, 0, 0]]);
		await searchAdminMemories(env, authz, { query: "knowledge", mode });
		expect(embed).toHaveBeenCalledTimes(mode === "fts" ? 0 : 1);
		expect(vi.mocked(searchMemories).mock.calls[0]?.[1].mode).toBe(mode);
		embed.mockRestore();
	});

	it("preserves caller-provided vectors without loading gateway settings", async () => {
		const { env } = fixture();
		const request = { vector: { profile: "tiny", values: [1, 0, 0] } };
		await searchAdminMemories(env, authz, request);
		expect(vi.mocked(searchMemories).mock.calls[0]?.[1]).toEqual(request);
	});

	it.each(["unconfigured", "gateway", "settings", "empty"])(
		"falls back safely for %s",
		async (failure) => {
			const { env } = fixture();
			if (failure !== "unconfigured") await saveEmbeddingSettings(env, SETTINGS, "admin:local");
			if (failure === "settings") env.OCTO_SETTINGS_KEY = "invalid";
			const embed = vi.spyOn(GatewayEmbedder.prototype, "embed");
			if (failure === "empty") embed.mockResolvedValue([]);
			else embed.mockRejectedValue(new Error(SETTINGS.api_key));
			const response = await searchAdminMemories(env, authz, {
				query: "knowledge",
				mode: "vector",
			});
			expect(response.channels.vector).toMatchObject({ skipped: "embedder_unavailable" });
			expect(vi.mocked(searchMemories).mock.calls[0]?.[1]).toEqual({
				query: "knowledge",
				mode: "fts",
			});
			expect(JSON.stringify(response)).not.toContain(SETTINGS.api_key);
			embed.mockRestore();
		},
	);
});
