import { z } from "zod";
import type { ApiKeyRow, MintInput } from "../auth/api-key";
import { ROLE_TEMPLATES } from "../auth/authorize";
import { ApiError } from "../lib/errors";
import { parseStrict } from "../lib/validate";
import { spaceSlugSchema } from "./spaces";

const fields = {
	name: z.string().trim().min(1).max(128),
	role: z.enum(["admin", "project", "drop", "readonly", "custom"]),
	ops: z
		.string()
		.regex(/^(?:[rwud](?:,[rwud])*)?$/)
		.refine((ops) => {
			const flags = ops.split(",");
			return new Set(flags).size === flags.length;
		}),
	scope: z.enum(["all", "spaces", "own"]),
	space_ids: z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length),
	own_entries_only: z.boolean(),
	auto_own_space: z.boolean(),
	expires_at: z.iso.datetime().nullable(),
};

const optionalFields = z.strictObject(fields).partial();
export const keyPatchSchema = optionalFields.refine((input) => Object.keys(input).length > 0);
export const keyCreateSchema = optionalFields.extend({
	name: fields.name,
	role: fields.role,
});
export const keyRotateSchema = z.strictObject({
	grace_ms: z
		.number()
		.int()
		.min(0)
		.max(7 * 24 * 60 * 60 * 1000)
		.default(0),
});

type KeyInput = z.infer<typeof keyPatchSchema>;
export type ResolvedKeyInput = Required<MintInput>;

function fieldError(message: string, paths: (keyof typeof fields)[]): ApiError {
	return new ApiError("validation_failed", message, {
		issues: paths.map((path) => ({ path, message })),
	});
}

function storedSpaceIds(json: string): string[] {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		throw new ApiError("validation_failed", "stored space ids must contain an array of space ids");
	}
	return parseStrict(
		z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length),
		value,
	);
}

export async function resolveKeyInput(
	db: D1Database,
	input: KeyInput,
	existing?: ApiKeyRow,
): Promise<ResolvedKeyInput> {
	const role = input.role ?? existing?.role;
	const reset = !existing || (input.role !== undefined && input.role !== existing.role);
	const template =
		role && role !== "custom" ? ROLE_TEMPLATES[role as keyof typeof ROLE_TEMPLATES] : undefined;
	const ops = input.ops ?? (reset ? template?.ops : existing.ops);
	const scope = input.scope ?? (reset ? template?.scope : existing.scope);
	if (ops === undefined || scope === undefined) {
		throw fieldError("custom keys require explicit ops and scope", [
			...(ops === undefined ? ["ops" as const] : []),
			...(scope === undefined ? ["scope" as const] : []),
		]);
	}
	const autoOwnSpace =
		input.auto_own_space ??
		(reset ? (template?.autoOwnSpace ?? false) : existing.auto_own_space === 1);
	const name = input.name ?? (existing as ApiKeyRow).name;
	if (autoOwnSpace) parseStrict(z.strictObject({ name: spaceSlugSchema }), { name });
	if (template) {
		const permittedScope =
			role === "drop"
				? scope === "spaces" || scope === "own"
				: role === "readonly"
					? scope === "all" || scope === "spaces"
					: scope === template.scope;
		if (ops !== template.ops || !permittedScope || autoOwnSpace !== template.autoOwnSpace) {
			throw fieldError("template permissions cannot be overridden; use custom", [
				...(ops !== template.ops ? ["ops" as const] : []),
				...(!permittedScope ? ["scope" as const] : []),
				...(autoOwnSpace !== template.autoOwnSpace ? ["auto_own_space" as const] : []),
			]);
		}
	}
	const ids = input.space_ids ?? (reset ? [] : storedSpaceIds(existing.space_ids_json));
	if (scope !== "spaces" && ids.length > 0) {
		throw fieldError("space ids require spaces scope", ["space_ids"]);
	}
	if (ids.length > 0) {
		const { results } = await db
			.prepare("SELECT id FROM spaces WHERE id IN (SELECT value FROM json_each(?))")
			.bind(JSON.stringify(ids))
			.all<{ id: string }>();
		if (results.length !== ids.length) throw fieldError("unknown space id", ["space_ids"]);
	}
	return {
		name,
		role: role as string,
		ops,
		scope,
		spaceIds: ids,
		ownEntriesOnly: input.own_entries_only ?? (reset ? false : existing.own_entries_only === 1),
		autoOwnSpace,
		expiresAt:
			input.expires_at === undefined
				? (existing?.expires_at ?? null)
				: input.expires_at === null
					? null
					: Date.parse(input.expires_at),
	};
}
