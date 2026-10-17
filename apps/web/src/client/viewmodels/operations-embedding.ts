import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";

export interface EmbeddingFields {
	base_url: string;
	model: string;
	dims: number;
	backfill_enabled: boolean;
}
export interface EmbeddingConfig extends EmbeddingFields {
	api_key_set: boolean;
	api_key_suffix: string | null;
}
export interface EmbeddingTestResult {
	latency_ms: number;
	actual_dims: number | null;
	dims_match: boolean;
	error_code: string | null;
}
interface EmbeddingState {
	config: EmbeddingConfig;
	loading: boolean;
	loaded: boolean;
	pending: boolean;
	error: string | null;
	testResult: EmbeddingTestResult | null;
}

function readable(config: EmbeddingConfig): EmbeddingConfig {
	const { base_url, model, dims, backfill_enabled, api_key_set, api_key_suffix } = config;
	return {
		base_url,
		model,
		dims,
		backfill_enabled,
		api_key_set,
		api_key_suffix: api_key_set && api_key_suffix ? api_key_suffix.slice(-4) : null,
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
				api_key_suffix: null,
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
			const config = await this.api.request<EmbeddingConfig>("/settings/embedding");
			if (this.alive && revision === this.revision)
				this.set({ config: readable(config), loading: false, loaded: true });
		} catch {
			if (this.alive && revision === this.revision)
				this.set({ loading: false, error: "Unable to load embedding settings." });
		}
	}

	async save(fields: EmbeddingFields, secret?: string | null): Promise<boolean> {
		if (!this.prepare(fields, secret)) return false;
		try {
			await this.api.request("/settings/embedding", {
				method: "PUT",
				json: payload(fields, secret),
			});
			if (!this.alive) return false;
			await this.load();
			return this.alive;
		} catch {
			if (this.alive) this.set({ error: "Unable to save embedding settings." });
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
			const { latency_ms, actual_dims, dims_match, error_code } = result;
			if (this.alive) this.set({ testResult: { latency_ms, actual_dims, dims_match, error_code } });
		} catch {
			if (this.alive) this.set({ error: "Unable to test embedding connection." });
		} finally {
			if (this.alive) this.set({ pending: false });
		}
	}

	dispose(): void {
		this.alive = false;
		this.revision++;
		this.set({ pending: false, loading: false });
	}

	private prepare(fields: EmbeddingFields, secret?: string | null): boolean {
		if (!this.alive || !this.state.loaded || this.state.pending) return false;
		if (!valid(fields, secret)) {
			this.set({
				error:
					"Provide a valid gateway URL, model, dimensions (1-1536) and nonempty replacement key.",
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
}
export class SettingsModel extends Store<{
	profiles: EmbeddingProfile[];
	loading: boolean;
	loaded: boolean;
	error: string | null;
}> {
	private revision = 0;
	constructor(private readonly api: AdminClient = adminApi) {
		super({ profiles: [], loading: false, loaded: false, error: null });
	}
	async load(): Promise<void> {
		const revision = ++this.revision;
		this.set({ loading: true, error: null });
		try {
			const result = await this.api.request<{ items: EmbeddingProfile[] }>("/embedding-profiles");
			if (revision === this.revision)
				this.set({ profiles: result.items, loading: false, loaded: true });
		} catch {
			if (revision === this.revision)
				this.set({ error: "Unable to load embedding profiles.", loading: false });
		}
	}
	dispose(): void {
		this.revision++;
	}
}
