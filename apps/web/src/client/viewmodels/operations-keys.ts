import { type AdminClient, adminApi } from "../lib/api";
import { Store } from "../lib/store";
import { operationsError } from "./operations-errors";

export type KeyRole = "admin" | "project" | "drop" | "readonly" | "custom";
export interface KeyPermissions {
	ops: string;
	scope: "all" | "spaces" | "own";
	space_ids: string[];
	own_entries_only: boolean;
	auto_own_space: boolean;
}
export interface KeyMetadata extends KeyPermissions {
	id: string;
	name: string;
	role: KeyRole;
	expires_at: string | null;
	revoked_at: string | null;
	last_used_at: string | null;
	created_at: string;
	updated_at: string;
}
export interface KeyDraft {
	name: string;
	role: KeyRole;
	expires_at: string | null;
	permissions?: KeyPermissions;
}
interface KeysState {
	items: KeyMetadata[];
	loading: boolean;
	loaded: boolean;
	pending: boolean;
	error: string | null;
}

export function rolePermissions(role: KeyRole): KeyPermissions {
	return {
		ops: { admin: "r,w,u,d", project: "r,w,u,d", drop: "w", readonly: "r", custom: "" }[role],
		scope: role === "admin" || role === "readonly" ? "all" : role === "project" ? "own" : "spaces",
		space_ids: [],
		own_entries_only: false,
		auto_own_space: role === "project",
	};
}

export function keyStatus(key: KeyMetadata, now = Date.now()): "active" | "expired" | "revoked" {
	if (key.revoked_at !== null) return "revoked";
	return key.expires_at !== null && Date.parse(key.expires_at) <= now ? "expired" : "active";
}

function metadata(key: KeyMetadata): KeyMetadata {
	const {
		id,
		name,
		role,
		ops,
		scope,
		space_ids,
		own_entries_only,
		auto_own_space,
		expires_at,
		revoked_at,
		last_used_at,
		created_at,
		updated_at,
	} = key;
	return {
		id,
		name,
		role,
		ops,
		scope,
		space_ids,
		own_entries_only,
		auto_own_space,
		expires_at,
		revoked_at,
		last_used_at,
		created_at,
		updated_at,
	};
}

function validExpiry(value: string | null): boolean {
	return (
		value === null ||
		(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
			Number.isFinite(Date.parse(value)))
	);
}

function validPermissions(value: KeyPermissions): boolean {
	return (
		/^(?:[rwud](?:,[rwud])*)$/.test(value.ops) &&
		new Set(value.ops.split(",")).size === value.ops.split(",").length &&
		(value.scope !== "spaces" || value.space_ids.length > 0)
	);
}

export class KeysModel extends Store<KeysState> {
	private revision = 0;
	private alive = true;
	constructor(private readonly api: AdminClient = adminApi) {
		super({ items: [], loading: false, loaded: false, pending: false, error: null });
	}

	async load(): Promise<void> {
		const revision = ++this.revision;
		this.set({ loading: true, error: null });
		try {
			const result = await this.api.request<{ items: KeyMetadata[] }>("/keys");
			if (this.alive && revision === this.revision)
				this.set({ items: result.items.map(metadata), loading: false, loaded: true });
		} catch (error) {
			if (this.alive && revision === this.revision)
				this.set({ loading: false, error: operationsError(error, "无法加载接口密钥。") });
		}
	}

	async create(draft: KeyDraft): Promise<string | null> {
		const permissions =
			draft.role === "custom" || draft.role === "drop"
				? draft.permissions
				: rolePermissions(draft.role);
		if (
			!draft.name.trim() ||
			(permissions?.auto_own_space && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.name.trim())) ||
			(permissions?.auto_own_space && draft.name.trim().length > 64) ||
			!validExpiry(draft.expires_at) ||
			!permissions ||
			!validPermissions(permissions)
		) {
			this.set({ error: "请填写名称、有效的到期时间并明确授权范围。" });
			return null;
		}
		const result = await this.change<{ plaintext: string }>("/keys", "POST", {
			name: draft.name.trim(),
			role: draft.role,
			expires_at: draft.expires_at,
			...(draft.role === "custom"
				? permissions
				: draft.role === "drop"
					? { space_ids: permissions.space_ids }
					: {}),
		});
		return result?.plaintext ?? null;
	}

	async rotate(id: string, graceSeconds: number): Promise<string | null> {
		if (!Number.isInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 604800) {
			this.set({ error: "轮换宽限期须为 0 至 604800 秒。" });
			return null;
		}
		const result = await this.change<{ plaintext: string }>(
			`/keys/${encodeURIComponent(id)}/rotate`,
			"POST",
			{ grace_ms: graceSeconds * 1000 },
		);
		return result?.plaintext ?? null;
	}

	async update(
		id: string,
		patch: { expires_at: string | null; role?: KeyRole; permissions?: KeyPermissions },
	): Promise<boolean> {
		if (!validExpiry(patch.expires_at)) {
			this.set({ error: "请填写有效的到期时间。" });
			return false;
		}
		const permissions =
			patch.role === "custom" || patch.role === "drop"
				? patch.permissions
				: patch.role
					? rolePermissions(patch.role)
					: undefined;
		if (patch.role && (!permissions || !validPermissions(permissions))) {
			this.set({ error: "请明确授权范围。" });
			return false;
		}
		return (
			(await this.change(`/keys/${encodeURIComponent(id)}`, "PATCH", {
				expires_at: patch.expires_at,
				...(patch.role
					? {
							role: patch.role,
							...(patch.role === "custom"
								? permissions
								: patch.role === "drop"
									? { space_ids: permissions?.space_ids }
									: {}),
						}
					: {}),
			})) !== null
		);
	}

	async revoke(id: string): Promise<boolean> {
		return (await this.change(`/keys/${encodeURIComponent(id)}/revoke`, "POST")) !== null;
	}

	dispose(): void {
		this.alive = false;
		this.revision++;
		this.set({ pending: false, loading: false });
	}

	private async change<Result>(
		path: string,
		method: string,
		json?: unknown,
	): Promise<Result | null> {
		if (!this.alive || this.state.pending) return null;
		this.set({ pending: true, error: null });
		try {
			const result = await this.api.request<Result>(path, {
				method,
				...(json === undefined ? {} : { json }),
			});
			if (!this.alive) return null;
			await this.load();
			if (!this.alive) return null;
			return result;
		} catch (error) {
			if (this.alive) this.set({ error: operationsError(error, "无法修改接口密钥。") });
			return null;
		} finally {
			if (this.alive) this.set({ pending: false });
		}
	}
}
