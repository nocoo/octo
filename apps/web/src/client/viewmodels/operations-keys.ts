import { z } from "zod";
import { type AdminClient, ApiError, adminApi } from "../lib/api";
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
export type KeyField =
	| "name"
	| "role"
	| "ops"
	| "scope"
	| "space_ids"
	| "own_entries_only"
	| "auto_own_space"
	| "expires_at";
export type KeyFieldErrors = Partial<Record<KeyField, string>>;
export interface KeySpace {
	id: string;
	slug: string;
	name: string;
}
interface KeysState {
	items: KeyMetadata[];
	loading: boolean;
	loaded: boolean;
	pending: boolean;
	deleting: KeyMetadata | null;
	error: string | null;
	fieldErrors: KeyFieldErrors;
	spaces: KeySpace[];
	spacesLoading: boolean;
	spacesLoaded: boolean;
	spacesError: string | null;
}

const fieldMessages: Record<KeyField, string> = {
	name: "请填写 1 至 128 位的名称。",
	role: "请选择有效的角色模板。",
	ops: "请选择有效且不重复的操作。",
	scope: "请选择有效的空间范围。",
	space_ids: "请选择有效的现有空间；空间可能已删除，请刷新列表。",
	own_entries_only: "请检查仅操作本人记忆的设置。",
	auto_own_space: "请检查自动创建自有空间的设置和角色模板。",
	expires_at: "请填写有效的到期时间，或留空表示永不过期。",
};
const formError = "请检查标记的字段后重试。";

function serverFieldErrors(error: unknown): KeyFieldErrors {
	if (!(error instanceof ApiError) || error.code !== "validation_failed") return {};
	const errors: KeyFieldErrors = {};
	for (const issue of error.details?.issues ?? []) {
		const field = issue.path.split(".")[0] as KeyField;
		if (Object.hasOwn(fieldMessages, field)) errors[field] = fieldMessages[field];
	}
	return errors;
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

function draftPermissions(role: KeyRole, permissions?: KeyPermissions): KeyPermissions | undefined {
	if (role === "custom" || role === "drop") return permissions;
	const template = rolePermissions(role);
	return role === "readonly" && permissions
		? { ...template, scope: permissions.scope, space_ids: permissions.space_ids }
		: template;
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
	return value === null || z.iso.datetime().safeParse(value).success;
}

export class KeysModel extends Store<KeysState> {
	private revision = 0;
	private spacesRevision = 0;
	private alive = true;
	constructor(private readonly api: AdminClient = adminApi) {
		super({
			items: [],
			loading: false,
			loaded: false,
			pending: false,
			deleting: null,
			error: null,
			fieldErrors: {},
			spaces: [],
			spacesLoading: false,
			spacesLoaded: false,
			spacesError: null,
		});
	}

	clearFormErrors(): void {
		this.set({ error: null, fieldErrors: {} });
	}

	clearFieldError(field: KeyField): void {
		const fieldErrors = { ...this.state.fieldErrors };
		delete fieldErrors[field];
		this.set({ fieldErrors, ...(Object.keys(fieldErrors).length === 0 ? { error: null } : {}) });
	}

	async loadSpaces(): Promise<void> {
		if (!this.alive) return;
		const revision = ++this.spacesRevision;
		this.set({ spacesLoading: true, spacesError: null });
		try {
			const result = await this.api.request<{ items: KeySpace[] }>("/spaces");
			if (this.alive && revision === this.spacesRevision)
				this.set({
					spaces: result.items.map(({ id, slug, name }) => ({ id, slug, name })),
					spacesLoading: false,
					spacesLoaded: true,
				});
		} catch (error) {
			if (this.alive && revision === this.spacesRevision)
				this.set({
					spacesLoading: false,
					spacesLoaded: false,
					spacesError: operationsError(error, "无法加载空间列表，请重试。"),
				});
		}
	}

	async load(): Promise<void> {
		const revision = ++this.revision;
		this.set({ loading: true, error: null });
		try {
			const result = await this.api.request<{ items: KeyMetadata[] }>("/keys");
			if (this.alive && revision === this.revision) {
				const items = result.items.map(metadata);
				this.set({
					items,
					loading: false,
					loaded: true,
					deleting:
						items.find((item) => item.id === this.state.deleting?.id && item.revoked_at !== null) ??
						null,
				});
			}
		} catch (error) {
			if (this.alive && revision === this.revision)
				this.set({ loading: false, error: operationsError(error, "无法加载接口密钥。") });
		}
	}

	async create(draft: KeyDraft): Promise<string | null> {
		const permissions = draftPermissions(draft.role, draft.permissions);
		if (!this.validate(draft, permissions) || !permissions) return null;
		const result = await this.change<{ plaintext: string }>("/keys", "POST", {
			name: draft.name.trim(),
			role: draft.role,
			expires_at: draft.expires_at,
			...(draft.role === "custom"
				? permissions
				: draft.role === "drop"
					? { space_ids: permissions.space_ids }
					: draft.role === "readonly" && draft.permissions
						? { scope: permissions.scope, space_ids: permissions.space_ids }
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
		patch: {
			name?: string;
			expires_at: string | null;
			role?: KeyRole;
			permissions?: KeyPermissions;
		},
	): Promise<boolean> {
		const permissions = patch.role ? draftPermissions(patch.role, patch.permissions) : undefined;
		if (
			!this.validate(
				{ ...patch, name: patch.name ?? this.state.items.find((item) => item.id === id)?.name },
				permissions,
			)
		)
			return false;
		return (
			(await this.change(`/keys/${encodeURIComponent(id)}`, "PATCH", {
				...(patch.name === undefined ? {} : { name: patch.name.trim() }),
				expires_at: patch.expires_at,
				...(patch.role
					? {
							role: patch.role,
							...(patch.role === "custom"
								? permissions
								: patch.role === "drop"
									? { space_ids: permissions?.space_ids }
									: patch.role === "readonly" && patch.permissions
										? { scope: permissions?.scope, space_ids: permissions?.space_ids }
										: {}),
						}
					: {}),
			})) !== null
		);
	}

	async revoke(id: string): Promise<boolean> {
		return (await this.change(`/keys/${encodeURIComponent(id)}/revoke`, "POST")) !== null;
	}

	openDelete(id: string): void {
		if (!this.alive || this.state.pending) return;
		const key = this.state.items.find((item) => item.id === id);
		if (!key || key.revoked_at === null) return;
		this.set({ deleting: key, error: null, fieldErrors: {} });
	}

	cancelDelete(): void {
		if (this.state.pending) return;
		this.set({ deleting: null, error: null, fieldErrors: {} });
	}

	async deleteRevoked(): Promise<boolean> {
		const key = this.state.deleting;
		if (!key) return false;
		if ((await this.change(`/keys/${encodeURIComponent(key.id)}`, "DELETE")) === null) return false;
		this.set({ deleting: null, items: this.state.items.filter((item) => item.id !== key.id) });
		return true;
	}

	dispose(): void {
		this.alive = false;
		this.revision++;
		this.spacesRevision++;
		this.set({ pending: false, loading: false, spacesLoading: false, deleting: null });
	}

	private validate(
		draft: { name?: string | undefined; role?: KeyRole; expires_at: string | null },
		permissions?: KeyPermissions,
	): boolean {
		const errors: KeyFieldErrors = {};
		if (draft.name !== undefined && (!draft.name.trim() || draft.name.trim().length > 128))
			errors.name = "请填写 1 至 128 位的名称。";
		if (!validExpiry(draft.expires_at)) errors.expires_at = fieldMessages.expires_at;
		if (draft.role) {
			if (
				!permissions ||
				!/^(?:[rwud](?:,[rwud])*)?$/.test(permissions.ops) ||
				new Set(permissions.ops.split(",")).size !== permissions.ops.split(",").length
			)
				errors.ops = fieldMessages.ops;
			if (!permissions) errors.scope = fieldMessages.scope;
			if (draft.role === "readonly" && permissions?.scope === "own")
				errors.scope = fieldMessages.scope;
			if (
				permissions?.scope === "spaces" &&
				(!this.state.spacesLoaded ||
					!permissions.space_ids.length ||
					new Set(permissions.space_ids).size !== permissions.space_ids.length ||
					permissions.space_ids.some((id) => !this.state.spaces.some((space) => space.id === id)))
			)
				errors.space_ids = fieldMessages.space_ids;
		}
		this.set({ fieldErrors: errors, error: Object.keys(errors).length ? formError : null });
		return Object.keys(errors).length === 0;
	}

	private async change<Result>(
		path: string,
		method: string,
		json?: unknown,
	): Promise<Result | null> {
		if (!this.alive || this.state.pending) return null;
		this.set({ pending: true, error: null, fieldErrors: {} });
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
			if (this.alive) {
				const fieldErrors = serverFieldErrors(error);
				this.set({
					fieldErrors,
					error: Object.keys(fieldErrors).length
						? formError
						: operationsError(error, "无法修改接口密钥。"),
				});
			}
			return null;
		} finally {
			if (this.alive) this.set({ pending: false });
		}
	}
}
