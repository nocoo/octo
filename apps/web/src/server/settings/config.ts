import { z } from "zod";
import type { EmbeddingFailureReason } from "../../lib/schema/embedding";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { EmbeddingFailure, reportEmbeddingFailure } from "../ports/embedder/diagnostics";
import { EmbeddingDimensionError, GatewayEmbedder } from "../ports/embedder/gateway";
import type { EmbedderConfig, QueryEmbedder } from "../ports/embedder/types";
import type { EmbeddingProfile } from "../repo/memories-vector";
import { decryptApiKey, encryptApiKey, settingsUnavailable } from "./crypto";
import { validateEmbeddingUrl } from "./url";

const inputSchema = z.strictObject({
	base_url: z.string().min(1).max(2048).nullable().optional(),
	api_key: z
		.string()
		.min(1)
		.max(4096)
		.regex(/^[\x21-\x7e]+$/)
		.nullable()
		.optional(),
	model: z.string().min(1).max(256).optional(),
	dims: z.number().int().min(1).max(1536).optional(),
	backfill_enabled: z.boolean().optional(),
});

type SettingsInput = z.infer<typeof inputSchema>;
type SettingRow = {
	key: string;
	value: string | null;
	ciphertext_hex: string;
	iv_hex: string;
	key_version: number | null;
	updated_by: string;
	updated_at: number;
};

export type EmbeddingSettings = {
	base_url: string | null;
	model: string;
	dims: number;
	backfill_enabled: boolean;
	api_key_set: boolean;
	api_key_mask: string | null;
};

export type LoadedEmbeddingConfig = EmbedderConfig & {
	profileId: string;
	backfillEnabled: boolean;
};

export const SETTINGS_SNAPSHOT_SQL = `(SELECT json_group_array(json_array(key, value, hex(ciphertext), hex(iv), key_version, updated_by, updated_at)) FROM (SELECT * FROM settings WHERE key GLOB 'embedding.*' ORDER BY key))`;

export type EmbeddingState = {
	profile: EmbeddingProfile;
	rows: SettingRow[];
	snapshot: string;
	settings: Omit<EmbeddingSettings, "api_key_set" | "api_key_mask">;
};

function parseInput(input: unknown): SettingsInput {
	const result = inputSchema.safeParse(input);
	if (!result.success) throw new ApiError("validation_failed", "invalid embedding settings");
	return result.data;
}

export async function readEmbeddingState(env: Env): Promise<EmbeddingState> {
	const profiles = await env.DB.prepare(
		"SELECT id, model, dims FROM embedding_profiles WHERE active = 1 ORDER BY id LIMIT 2",
	).all<EmbeddingProfile>();
	const profile = profiles.results[0];
	if (!profile || profiles.results.length !== 1) throw settingsUnavailable();
	const { results: rows } = await env.DB.prepare(
		"SELECT key, value, hex(ciphertext) AS ciphertext_hex, hex(iv) AS iv_hex, key_version, updated_by, updated_at FROM settings WHERE key GLOB 'embedding.*' ORDER BY key",
	).all<SettingRow>();
	const values = new Map(rows.map((row) => [row.key, row.value]));
	const model = values.get("embedding.model") ?? profile.model;
	const dims = Number(values.get("embedding.dims") ?? profile.dims);
	const base = values.get("embedding.base_url") ?? null;
	return {
		profile,
		rows,
		snapshot: JSON.stringify(
			rows.map((row) => [
				row.key,
				row.value,
				row.ciphertext_hex,
				row.iv_hex,
				row.key_version,
				row.updated_by,
				row.updated_at,
			]),
		),
		settings: {
			base_url: base,
			model,
			dims,
			backfill_enabled: values.get("embedding.backfill_enabled") === "true",
		},
	};
}

async function storedApiKey(env: Env, state: EmbeddingState): Promise<string | null> {
	const row = state.rows.find((setting) => setting.key === "embedding.api_key");
	if (!row) return null;
	const bytes = (hex: string) =>
		Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
	try {
		return await decryptApiKey(env.OCTO_SETTINGS_KEY, {
			ciphertext: bytes(row.ciphertext_hex),
			iv: bytes(row.iv_hex),
			key_version: row.key_version ?? 0,
		});
	} catch {
		throw new EmbeddingFailure({ stage: "decrypt" }, "embedding settings unavailable");
	}
}

function mergedSettings(env: Env, state: EmbeddingState, input: SettingsInput) {
	const base = input.base_url === undefined ? state.settings.base_url : input.base_url;
	const settings = {
		model: input.model ?? state.settings.model,
		dims: input.dims ?? state.settings.dims,
		backfill_enabled: input.backfill_enabled ?? state.settings.backfill_enabled,
		base_url: base === null ? null : validateEmbeddingUrl(base, env.RESOURCE_ENV),
	};
	if (settings.model !== state.profile.model || settings.dims !== state.profile.dims) {
		throw new ApiError(
			"validation_failed",
			"embedding model and dimensions must match active profile",
		);
	}
	return settings;
}

function publicSettings(state: EmbeddingState, apiKey: string | null): EmbeddingSettings {
	return {
		...state.settings,
		api_key_set: apiKey !== null,
		api_key_mask: apiKey === null ? null : apiKey.length > 4 ? `****${apiKey.slice(-4)}` : "****",
	};
}

export async function getEmbeddingSettings(env: Env): Promise<EmbeddingSettings> {
	const state = await readEmbeddingState(env);
	return publicSettings(state, await storedApiKey(env, state));
}

export async function configFromState(
	env: Env,
	state: EmbeddingState,
): Promise<LoadedEmbeddingConfig | null> {
	const apiKey = await storedApiKey(env, state);
	if (!state.settings.base_url || !apiKey) return null;
	if (state.settings.model !== state.profile.model || state.settings.dims !== state.profile.dims)
		throw settingsUnavailable();
	let baseUrl: string;
	try {
		baseUrl = validateEmbeddingUrl(state.settings.base_url, env.RESOURCE_ENV);
	} catch {
		throw settingsUnavailable();
	}
	return {
		baseUrl,
		apiKey,
		model: state.settings.model,
		dims: state.settings.dims,
		profileId: state.profile.id,
		backfillEnabled: state.settings.backfill_enabled,
	};
}

export async function saveEmbeddingSettings(
	env: Env,
	body: unknown,
	actor: string,
): Promise<EmbeddingSettings> {
	const input = parseInput(body);
	const state = await readEmbeddingState(env);
	const settings = mergedSettings(env, state, input);
	const apiKey = input.api_key === undefined ? await storedApiKey(env, state) : input.api_key;
	const encrypted =
		typeof input.api_key === "string"
			? await encryptApiKey(env.OCTO_SETTINGS_KEY, input.api_key)
			: null;
	const now = Date.now();
	const guard = `(SELECT COUNT(*) FROM embedding_profiles WHERE active = 1) = 1 AND EXISTS (SELECT 1 FROM embedding_profiles WHERE id = ? AND model = ? AND dims = ? AND active = 1) AND ${SETTINGS_SNAPSHOT_SQL} = ?`;
	const guardParams = [state.profile.id, state.profile.model, state.profile.dims, state.snapshot];
	const writes: Array<
		[
			key: string,
			value: string | null,
			ciphertext?: Uint8Array,
			iv?: Uint8Array,
			keyVersion?: number,
		]
	> = [
		["embedding.base_url", settings.base_url],
		["embedding.model", settings.model],
		["embedding.dims", String(settings.dims)],
		["embedding.backfill_enabled", String(settings.backfill_enabled)],
	];
	if (encrypted)
		writes.push([
			"embedding.api_key",
			null,
			encrypted.ciphertext,
			encrypted.iv,
			encrypted.key_version,
		]);
	const statements = writes.map(
		([key, value, ciphertext = null, iv = null, keyVersion = null], index) =>
			env.DB.prepare(
				`INSERT INTO settings (key, value, ciphertext, iv, key_version, updated_by, updated_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${index === 0 ? guard : "changes() = 1"} ON CONFLICT(key) DO UPDATE SET value = excluded.value, ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
			).bind(
				key,
				value,
				ciphertext,
				iv,
				keyVersion,
				actor,
				now,
				...(index === 0 ? guardParams : []),
			),
	);
	if (input.api_key === null)
		statements.push(
			env.DB.prepare("DELETE FROM settings WHERE key = 'embedding.api_key' AND changes() = 1"),
		);
	const results = await env.DB.batch(statements);
	if (results[0]?.meta.changes !== 1)
		throw new ApiError("validation_failed", "embedding settings or active profile changed");
	return publicSettings({ ...state, settings }, apiKey);
}

export async function testEmbeddingSettings(
	env: Env,
	body: unknown,
): Promise<{
	latency_ms: number;
	dims: number | null;
	match: boolean;
	error_code: "embedder_unavailable" | "vector_dimension_mismatch" | null;
	reason: EmbeddingFailureReason | null;
}> {
	const input = parseInput(body);
	let baseUrl: string | null = null;
	const started = performance.now();
	const result = (
		dims: number | null,
		match: boolean,
		error_code: "embedder_unavailable" | "vector_dimension_mismatch" | null,
		reason: EmbeddingFailureReason | null = null,
	) => ({
		latency_ms: Math.max(0, Math.round(performance.now() - started)),
		dims,
		match,
		error_code,
		reason,
	});
	try {
		const state = await readEmbeddingState(env);
		baseUrl = input.base_url === undefined ? state.settings.base_url : input.base_url;
		const settings = mergedSettings(env, state, input);
		const apiKey = input.api_key === undefined ? await storedApiKey(env, state) : input.api_key;
		if (!settings.base_url || !apiKey) throw new EmbeddingFailure({ stage: "config" });
		const embedder: QueryEmbedder = new GatewayEmbedder({
			baseUrl: settings.base_url,
			apiKey,
			model: settings.model,
			dims: settings.dims,
		});
		await embedder.embed(["Octo embedding connection test."]);
		return result(settings.dims, true, null);
	} catch (error) {
		const reason = reportEmbeddingFailure("embedding_test_failed", error, baseUrl);
		if (error instanceof ApiError && !(error instanceof EmbeddingFailure)) throw error;
		return error instanceof EmbeddingDimensionError
			? result(error.actualDims, false, "vector_dimension_mismatch", reason)
			: result(null, false, "embedder_unavailable", reason);
	}
}
