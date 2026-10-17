import { vi } from "vitest";
import type { AdminClient } from "../../lib/api";
import type { Memory } from "../memories";

export const memory: Memory = {
	id: "m1",
	title: "Title",
	body: "# Heading\nHello",
	space: "notes",
	type: "note",
	tags: ["work"],
	importance: 0.5,
	event_time: null,
	version: 2,
	created_at: "2026-10-17T00:00:00.000Z",
	updated_at: "2026-10-17T01:00:00.000Z",
	source_key_id: "k1",
	updated_by_key_id: "k1",
	content_hash: "hash",
};

export function client() {
	const request = vi.fn<(...args: Parameters<AdminClient["request"]>) => Promise<unknown>>();
	const api: AdminClient = {
		request: <T>(...args: Parameters<AdminClient["request"]>) => request(...args) as Promise<T>,
	};
	return { request, api };
}
