import type { ApiKeyScope } from "./api-key";

export type OpFlag = "r" | "w" | "u" | "d";
export type AuthzOp = "read" | "write" | "update" | "delete" | "move" | "tag_global";

export type AuthzKey = {
	id: string;
	ops: ReadonlySet<OpFlag>;
	scope: ApiKeyScope;
	spaceIds: readonly string[];
	ownedSpaceIds: readonly string[];
	ownEntriesOnly: boolean;
};

export type ApiPrincipal = AuthzKey & {
	name: string;
	role: string;
	autoOwnSpace: boolean;
	expiresAt: number | null;
};

export type AuthzTarget = {
	spaceId?: string;
	destSpaceId?: string;
	sourceKeyId?: string;
};

export type AuthzResult = { allow: true } | { allow: false; reason: "not_found" | "forbidden" };

export type VisibleSpaces = { kind: "all" } | { kind: "ids"; ids: readonly string[] };

export const ROLE_TEMPLATES = {
	admin: { ops: "r,w,u,d", scope: "all" as const, autoOwnSpace: false },
	project: { ops: "r,w,u,d", scope: "own" as const, autoOwnSpace: true },
	drop: { ops: "w", scope: "spaces" as const, autoOwnSpace: false },
	readonly: { ops: "r", scope: "all" as const, autoOwnSpace: false },
} as const;

const OP_FLAG: Record<Exclude<AuthzOp, "move" | "tag_global">, OpFlag> = {
	read: "r",
	write: "w",
	update: "u",
	delete: "d",
};

export function parseOps(ops: string): Set<OpFlag> {
	const set = new Set<OpFlag>();
	for (const part of ops.split(",")) {
		const flag = part.trim();
		if (flag === "r" || flag === "w" || flag === "u" || flag === "d") {
			set.add(flag);
		}
	}
	return set;
}

export function spaceVisible(key: AuthzKey, spaceId: string): boolean {
	if (key.scope === "all") {
		return true;
	}
	if (key.scope === "spaces") {
		return key.spaceIds.includes(spaceId);
	}
	return key.ownedSpaceIds.includes(spaceId);
}

export function visibleSpaceIds(key: AuthzKey): VisibleSpaces {
	if (key.scope === "all") {
		return { kind: "all" };
	}
	return { kind: "ids", ids: key.scope === "spaces" ? key.spaceIds : key.ownedSpaceIds };
}

function denied(reason: "not_found" | "forbidden"): AuthzResult {
	return { allow: false, reason };
}

export function authorize(key: AuthzKey, op: AuthzOp, target: AuthzTarget): AuthzResult {
	if (op === "tag_global") {
		if (key.scope !== "all" || !key.ops.has("u")) {
			return denied("forbidden");
		}
		return { allow: true };
	}
	if (op === "move") {
		if (!target.spaceId || !target.destSpaceId) {
			return denied("not_found");
		}
		if (!spaceVisible(key, target.spaceId) || !spaceVisible(key, target.destSpaceId)) {
			return denied("not_found");
		}
		if (!key.ops.has("u")) {
			return denied("forbidden");
		}
		if (key.ownEntriesOnly && target.sourceKeyId !== key.id) {
			return denied("forbidden");
		}
		return { allow: true };
	}
	if (!target.spaceId || !spaceVisible(key, target.spaceId)) {
		return denied("not_found");
	}
	if (!key.ops.has(OP_FLAG[op])) {
		return denied("forbidden");
	}
	if (key.ownEntriesOnly && (op === "update" || op === "delete") && target.sourceKeyId !== key.id) {
		return denied("forbidden");
	}
	return { allow: true };
}
