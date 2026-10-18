import type { EmbeddingFailureReason } from "../../lib/schema/embedding";
import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { operationsError } from "./operations-errors";

export interface EmbeddingFields {
	base_url: string;
	model: string;
	dims: number;
	backfill_enabled: boolean;
}
export interface EmbeddingConfig extends EmbeddingFields {
	api_key_set: boolean;
	api_key_mask: string | null;
}
type EmbeddingResponse = Omit<EmbeddingConfig, "base_url"> & { base_url: string | null };
export interface EmbeddingTestResult {
	latency_ms: number;
	dims: number | null;
	match: boolean;
	error_code: "embedder_unavailable" | "vector_dimension_mismatch" | null;
	reason: EmbeddingFailureReason | null;
}

const FAILURE_STAGES = new Set<EmbeddingFailureReason["stage"]>([
	"config",
	"decrypt",
	"request",
	"status",
	"redirect",
	"timeout",
	"parse",
	"dims",
]);

const STAGE_LABELS: Record<EmbeddingFailureReason["stage"], string> = {
	config: "配置不完整",
	decrypt: "密钥解密失败",
	request: "网关请求失败",
	status: "上游状态异常",
	redirect: "上游重定向被拒绝",
	timeout: "网关请求超时",
	parse: "上游响应解析失败",
	dims: "向量维度不匹配",
};

export function embeddingFailureStageLabel(stage: EmbeddingFailureReason["stage"]): string {
	return STAGE_LABELS[stage];
}

function readReason(
	reason: unknown,
	errorCode: EmbeddingTestResult["error_code"],
): EmbeddingFailureReason | null {
	if (errorCode === null) {
		if (reason !== null) throw new Error("Invalid embedding test reason");
		return null;
	}
	if (reason === null || typeof reason !== "object")
		throw new Error("Invalid embedding test reason");
	const stage = (reason as { stage?: unknown }).stage;
	if (typeof stage !== "string" || !FAILURE_STAGES.has(stage as EmbeddingFailureReason["stage"]))
		throw new Error("Invalid embedding test reason");
	const upstream = (reason as { upstream_status?: unknown }).upstream_status;
	if (upstream !== undefined && (typeof upstream !== "number" || !Number.isInteger(upstream)))
		throw new Error("Invalid embedding test reason");
	return upstream === undefined
		? { stage: stage as EmbeddingFailureReason["stage"] }
		: { stage: stage as EmbeddingFailureReason["stage"], upstream_status: upstream };
}
interface EmbeddingState {
	config: EmbeddingConfig;
	loading: boolean;
	loaded: boolean;
	pending: boolean;
	error: string | null;
	testResult: EmbeddingTestResult | null;
}

function readable(config: EmbeddingResponse): EmbeddingConfig {
	const { base_url, model, dims, backfill_enabled, api_key_set, api_key_mask } = config;
	return {
		base_url: base_url ?? "",
		model,
		dims,
		backfill_enabled,
		api_key_set,
		api_key_mask:
			api_key_set && api_key_mask
				? `****${api_key_mask.length > 4 ? api_key_mask.slice(-4) : ""}`
				: null,
	};
}

function valid(fields: EmbeddingFields, secret?: string | null): boolean {
	try {
		const url = new URL(fields.base_url);
		if (
			!["https:", "http:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash ||
			url.search
		)
			return false;
	} catch {
		return false;
	}
	return (
		fields.model.trim().length > 0 &&
		Number.isInteger(fields.dims) &&
		fields.dims > 0 &&
		fields.dims <= 1536 &&
		(secret == null || secret.trim().length > 0)
	);
}

function payload(
	fields: EmbeddingFields,
	secret?: string | null,
): EmbeddingFields & { api_key?: string | null } {
	const { base_url, model, dims, backfill_enabled } = fields;
	return {
		base_url: base_url.trim(),
		model: model.trim(),
		dims,
		backfill_enabled,
		...(secret === undefined ? {} : { api_key: secret }),
	};
}

export class EmbeddingModel extends Store<EmbeddingState> {
	private revision = 0;
	private alive = true;
	constructor(private readonly api: AdminClient = adminApi) {
		super({
			config: {
				base_url: "",
				model: "text-embedding-3-small",
				dims: 1536,
				backfill_enabled: false,
				api_key_set: false,
				api_key_mask: null,
			},
			loading: false,
			loaded: false,
			pending: false,
			error: null,
			testResult: null,
		});
	}

	async load(): Promise<void> {
		const revision = ++this.revision;
		this.set({ loading: true, error: null });
		try {
			const config = await this.api.request<EmbeddingResponse>("/settings/embedding");
			if (this.alive && revision === this.revision)
				this.set({ config: readable(config), loading: false, loaded: true });
		} catch (error) {
			if (this.alive && revision === this.revision)
				this.set({ loading: false, error: operationsError(error, "无法加载嵌入设置。") });
		}
	}

	async save(fields: EmbeddingFields, secret?: string | null): Promise<boolean> {
		if (!this.prepare(fields, secret)) return false;
		return this.persist(payload(fields, secret));
	}

	async clearKey(): Promise<boolean> {
		if (!this.prepare()) return false;
		return this.persist({ api_key: null });
	}

	private async persist(
		json: Partial<EmbeddingFields> & { api_key?: string | null },
	): Promise<boolean> {
		try {
			await this.api.request("/settings/embedding", {
				method: "PUT",
				json,
			});
			if (!this.alive) return false;
			await this.load();
			return this.alive;
		} catch (error) {
			if (this.alive) this.set({ error: operationsError(error, "无法保存嵌入设置。") });
			return false;
		} finally {
			if (this.alive) this.set({ pending: false });
		}
	}

	async test(fields: EmbeddingFields, secret?: string | null): Promise<void> {
		if (!this.prepare(fields, secret)) return;
		try {
			const result = await this.api.request<EmbeddingTestResult>("/settings/embedding/test", {
				method: "POST",
				json: payload(fields, secret),
			});
			if (!Object.hasOwn(result, "reason")) throw new Error("Invalid embedding test reason");
			const { latency_ms, dims, match, error_code } = result;
			if (
				error_code !== null &&
				error_code !== "embedder_unavailable" &&
				error_code !== "vector_dimension_mismatch"
			)
				throw new Error("Invalid embedding test error code");
			const reason = readReason(result.reason, error_code);
			if (this.alive) this.set({ testResult: { latency_ms, dims, match, error_code, reason } });
		} catch (error) {
			if (this.alive) this.set({ error: operationsError(error, "无法测试嵌入连接。") });
		} finally {
			if (this.alive) this.set({ pending: false });
		}
	}

	dispose(): void {
		this.alive = false;
		this.revision++;
		this.set({ pending: false, loading: false });
	}

	private prepare(fields?: EmbeddingFields, secret?: string | null): boolean {
		if (!this.alive || !this.state.loaded || this.state.pending) return false;
		if (fields && !valid(fields, secret)) {
			this.set({
				error: "请填写有效的网关地址、模型、维度（1 至 1536）和非空替换密钥。",
			});
			return false;
		}
		this.set({ pending: true, error: null, testResult: null });
		return true;
	}
}

export interface EmbeddingProfile {
	id: string;
	model: string;
	dims: number;
	metric: string;
	active: boolean;
	created_at: string;
}
export class SettingsModel extends Store<{
	profiles: EmbeddingProfile[];
	activeProfile: string | null;
	loading: boolean;
	loaded: boolean;
	error: string | null;
}> {
	private revision = 0;
	constructor(private readonly api: AdminClient = adminApi) {
		super({ profiles: [], activeProfile: null, loading: false, loaded: false, error: null });
	}
	async load(): Promise<void> {
		const revision = ++this.revision;
		this.set({ loading: true, error: null });
		try {
			const result = await this.api.request<{
				items: EmbeddingProfile[];
				active_profile: string | null;
				next_cursor: null;
			}>("/embedding-profiles");
			if (revision === this.revision)
				this.set({
					profiles: result.items,
					activeProfile: result.active_profile,
					loading: false,
					loaded: true,
				});
		} catch (error) {
			if (revision === this.revision)
				this.set({ error: operationsError(error, "无法加载嵌入配置。"), loading: false });
		}
	}
	dispose(): void {
		this.revision++;
	}
}
