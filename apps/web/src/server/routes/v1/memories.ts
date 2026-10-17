import { Hono } from "hono";
import { z } from "zod";
import { memoryFiltersSchema } from "../../../lib/schema/filters";
import {
	MEMORY_BODY_MAX_BYTES,
	memoryCreateSchema,
	memoryPatchSchema,
	utf8Bytes,
} from "../../../lib/schema/memory";
import type { AppVars, Env } from "../../env";
import { ApiError, jsonOk } from "../../lib/errors";
import { parseStrict, readJsonLimited } from "../../lib/validate";
import { parseLimit } from "../../repo/memories-cursor";
import { authzFrom, MemoryService, parseInclude } from "../../services/memories";
import { memoryService } from "./memory-service";

const rollbackSchema = z.strictObject({
	to_version: z.number().int().positive(),
	expected_version: z.number().int().positive().optional(),
});

function csv(raw: string | null): string[] | undefined {
	if (raw == null || raw === "") {
		return undefined;
	}
	const parts = raw
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	return parts.length > 0 ? parts : undefined;
}

function filtersFromQuery(url: URL) {
	const raw: Record<string, unknown> = {};
	const spaces = csv(url.searchParams.get("spaces"));
	if (spaces) {
		raw.spaces = spaces;
	}
	const tagsAll = csv(url.searchParams.get("tags_all"));
	if (tagsAll) {
		raw.tags_all = tagsAll;
	}
	const tagsAny = csv(url.searchParams.get("tags_any"));
	if (tagsAny) {
		raw.tags_any = tagsAny;
	}
	const types = csv(url.searchParams.get("types"));
	if (types) {
		raw.types = types;
	}
	const sources = csv(url.searchParams.get("sources"));
	if (sources) {
		raw.sources = sources;
	}
	const field = url.searchParams.get("time_field");
	const from = url.searchParams.get("time_from");
	const to = url.searchParams.get("time_to");
	if (field || from || to) {
		const time: Record<string, unknown> = {};
		if (field) {
			time.field = field;
		}
		if (from) {
			time.from = from;
		}
		if (to) {
			time.to = to;
		}
		raw.time = time;
	}
	const min = url.searchParams.get("importance_min");
	const max = url.searchParams.get("importance_max");
	if (min || max) {
		const importance: Record<string, unknown> = {};
		if (min) {
			importance.min = Number(min);
		}
		if (max) {
			importance.max = Number(max);
		}
		raw.importance = importance;
	}
	return parseStrict(memoryFiltersSchema, raw);
}

async function readMemoryJson(request: Request): Promise<unknown> {
	const data = await readJsonLimited(request);
	if (
		data &&
		typeof data === "object" &&
		"body" in data &&
		typeof data.body === "string" &&
		utf8Bytes(data.body) > MEMORY_BODY_MAX_BYTES
	) {
		throw new ApiError("payload_too_large", "body exceeds 1MB UTF-8");
	}
	return data;
}

function service(db: D1Database): MemoryService {
	return new MemoryService(db);
}

export function memoriesRoutes(): Hono<{ Bindings: Env; Variables: AppVars }> {
	const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

	app.get("/", async (c) => {
		const url = new URL(c.req.url);
		const listed = await service(c.env.DB).list(authzFrom(c.get("apiKey")), {
			filters: filtersFromQuery(url),
			include: parseInclude(url.searchParams.get("include") ?? undefined),
			cursor: url.searchParams.get("cursor") ?? undefined,
			limit: parseLimit(url.searchParams.get("limit")),
		});
		return jsonOk(listed);
	});

	app.post("/", async (c) => {
		const body = parseStrict(memoryCreateSchema, await readMemoryJson(c.req.raw));
		const item = await memoryService(c).create(authzFrom(c.get("apiKey")), body);
		return jsonOk(item, 201);
	});

	app.get("/:id/versions/:v", async (c) => {
		const version = Number(c.req.param("v"));
		if (!Number.isInteger(version) || version < 1) {
			throw new ApiError("validation_failed", "invalid version");
		}
		const item = await service(c.env.DB).getVersion(
			authzFrom(c.get("apiKey")),
			c.req.param("id"),
			version,
		);
		return jsonOk(item);
	});

	app.get("/:id/versions", async (c) => {
		const items = await service(c.env.DB).listVersions(
			authzFrom(c.get("apiKey")),
			c.req.param("id"),
		);
		return jsonOk({ items });
	});

	app.get("/:id/diff", async (c) => {
		const url = new URL(c.req.url);
		const from = Number(url.searchParams.get("from"));
		const to = Number(url.searchParams.get("to"));
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
			throw new ApiError("validation_failed", "from and to versions are required");
		}
		const item = await service(c.env.DB).diff(
			authzFrom(c.get("apiKey")),
			c.req.param("id"),
			from,
			to,
		);
		return jsonOk(item);
	});

	app.post("/:id/rollback", async (c) => {
		const body = parseStrict(rollbackSchema, await readJsonLimited(c.req.raw));
		const item = await memoryService(c).rollback(
			authzFrom(c.get("apiKey")),
			c.req.param("id"),
			body.to_version,
			c.req.header("If-Match") ?? undefined,
			body.expected_version,
		);
		return jsonOk(item);
	});

	app.get("/:id", async (c) => {
		const url = new URL(c.req.url);
		const item = await service(c.env.DB).get(
			authzFrom(c.get("apiKey")),
			c.req.param("id"),
			parseInclude(url.searchParams.get("include") ?? undefined),
		);
		return jsonOk(item);
	});

	app.patch("/:id", async (c) => {
		const body = parseStrict(memoryPatchSchema, await readMemoryJson(c.req.raw));
		const item = await memoryService(c).patch(
			authzFrom(c.get("apiKey")),
			c.req.param("id"),
			body,
			c.req.header("If-Match") ?? undefined,
		);
		return jsonOk(item);
	});

	app.delete("/:id", async (c) => {
		const item = await memoryService(c).remove(authzFrom(c.get("apiKey")), c.req.param("id"));
		return jsonOk(item);
	});

	return app;
}

export { filtersFromQuery };
